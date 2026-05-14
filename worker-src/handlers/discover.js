/**
 * discover.js — Phase 12 knowledge harvester.
 *
 * Fans out a query across academic + patent sources, dedupes results,
 * persists them in `discovered_sources`, then asks Claude to extract
 * formulations from any abstract long enough to contain one. New
 * formulas land in `formulas` with attribution back to the source.
 *
 * Providers:
 *  - Semantic Scholar    (papers, free)
 *  - Europe PMC          (PubMed + PMC + full text where available)
 *  - arXiv               (preprints)
 *  - Crossref / Lens     (patents, best-effort)
 */
import { json, unauthorized, badRequest } from '../lib/responses.js';
import { sbService } from '../lib/supabase.js';
import { CLAUDE_MODEL } from '../lib/claude.js';

const DISCOVER_PROVIDERS = ['semantic_scholar', 'pubmed', 'lens', 'arxiv'];

/* ─── /discover ──────────────────────────────────────────────── */

export async function handleDiscover(request, auth, env) {
  if (auth.kind !== 'user') return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid_json');
  }

  let query = String(body.query || '').trim();
  if (!query) return badRequest('empty_query');
  if (query.length > 200) query = query.slice(0, 200);
  const words = query.split(/\s+/);
  if (words.length > 8) query = words.slice(0, 8).join(' ');

  const sources =
    Array.isArray(body.sources) && body.sources.length
      ? body.sources.filter((s) => DISCOVER_PROVIDERS.includes(s))
      : DISCOVER_PROVIDERS;
  const maxPerSource = Math.min(Math.max(parseInt(body.max_per_source) || 8, 1), 20);

  // Register the job
  let jobId = null;
  try {
    const r = await sbService(env, '/discovery_jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: auth.userId,
        query,
        sources,
        status: 'running',
      }),
    });
    if (r.ok) jobId = (await r.json())[0]?.id || null;
  } catch {
    /* continue */
  }

  // Fan out
  const searches = await Promise.allSettled(
    sources.map((src) => searchProvider(src, query, maxPerSource))
  );
  const allResults = [];
  searches.forEach((s, i) => {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      for (const item of s.value) allResults.push({ ...item, provider: sources[i] });
    }
  });

  // Dedupe by provider+external_id|title
  const seen = new Set();
  const dedup = allResults.filter((r) => {
    const key = `${r.provider}:${r.external_id || r.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Persist sources
  const sourceRows = [];
  for (const r of dedup) {
    try {
      const ins = await sbService(env, '/discovered_sources?on_conflict=provider,external_id', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify({
          job_id: jobId,
          source_type: r.source_type,
          provider: r.provider,
          external_id: r.external_id || null,
          title: r.title,
          authors: r.authors || null,
          abstract: r.abstract || null,
          year: r.year || null,
          journal_or_office: r.journal_or_office || null,
          url: r.url || null,
        }),
      });
      if (ins.ok) {
        const arr = await ins.json();
        if (arr[0]) sourceRows.push(arr[0]);
      }
    } catch {
      /* ignore */
    }
  }

  // Extract formulas from each source's abstract
  let totalExtracted = 0;
  const extractionDetails = [];
  for (const src of sourceRows) {
    if (!src.abstract || src.abstract.length < 200) continue;
    try {
      const formulas = await extractFromAbstract(src, env);
      if (Array.isArray(formulas) && formulas.length) {
        let inserted = 0;
        for (const f of formulas) {
          if (!f.name || !Array.isArray(f.components) || !f.components.length) continue;
          const hasPct = f.components.some(
            (c) => Number.isFinite(parseFloat(c.percentage)) && parseFloat(c.percentage) > 0
          );
          if (!hasPct) continue;

          // Auto-balance: add water as remainder if under 100%
          let total = f.components.reduce(
            (s, c) => s + (parseFloat(c.percentage) || 0),
            0
          );
          const comps = [...f.components];
          if (total < 95) {
            const remainder = 100 - total;
            comps.push({
              name_en: 'Water (Aqua)',
              cas_number: '7732-18-5',
              percentage: parseFloat(remainder.toFixed(2)),
              function: 'solvent',
            });
            total = 100;
          } else if (total > 105) {
            continue; // skip oversaturated
          }

          const completeness =
            f.completeness === 'complete'
              ? 'complete'
              : f.completeness === 'partial'
                ? 'partial'
                : Math.abs(100 - total) < 1
                  ? 'complete'
                  : 'partial';
          const trustScore = completeness === 'complete' ? 75 : 60;

          try {
            const ok = await sbService(env, '/formulas', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({
                name: f.name,
                name_en: f.name,
                category: f.category || 'specialty',
                form_type: f.form_type || 'liquid',
                components: comps,
                process_conditions: { ...(f.process_conditions || {}), completeness },
                trust_score: trustScore,
                source_title: src.title,
                source_author: src.authors,
                source_year: src.year,
                source_url: src.url,
                discovered_source_id: src.id,
                added_by_user_id: auth.userId,
              }),
            });
            if (ok.ok) inserted++;
          } catch {
            /* ignore individual failures */
          }
        }
        totalExtracted += inserted;
        extractionDetails.push({
          source_id: src.id,
          title: src.title,
          found: formulas.length,
          inserted,
        });
        if (inserted > 0) {
          try {
            await sbService(env, `/discovered_sources?id=eq.${src.id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
              },
              body: JSON.stringify({ has_formula: true, formulas_found: inserted }),
            });
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore individual source failures */
    }
  }

  // Mark job done
  if (jobId) {
    try {
      await sbService(env, `/discovery_jobs?id=eq.${jobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'done',
          results_found: dedup.length,
          formulas_extracted: totalExtracted,
        }),
      });
    } catch {
      /* ignore */
    }
  }

  return json({
    job_id: jobId,
    sources_searched: sources,
    results_found: dedup.length,
    formulas_extracted: totalExtracted,
    by_source: countBy(dedup.map((r) => r.provider)),
    details: extractionDetails.slice(0, 10),
  });
}

export async function handleListDiscoveryJobs(auth, env) {
  if (auth.kind !== 'user') return json({ jobs: [] });
  const path = `/discovery_jobs?user_id=eq.${auth.userId}&select=id,query,sources,status,results_found,formulas_extracted,created_at&order=created_at.desc&limit=50`;
  const r = await sbService(env, path);
  if (!r.ok) return json({ jobs: [] });
  return json({ jobs: await r.json() });
}

/* ─── /discover/debug ────────────────────────────────────────── */
// Diagnostic: runs ONE Europe PMC search + ONE Claude extraction with all
// intermediate steps logged. Useful when discovery returns 0 results.

export async function handleDiscoverDebug(url, auth, env) {
  if (auth.kind !== 'user') return unauthorized();
  const query = (url.searchParams.get('q') || 'WHO alcohol-based handrub formulation').trim();

  const out = { query, steps: [] };

  const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=3&resultType=core`;
  let papers = [];
  try {
    const r = await fetch(epmcUrl, { headers: { Accept: 'application/json' } });
    out.steps.push({ step: '1_search', status: r.status, ok: r.ok });
    if (r.ok) {
      const data = await r.json();
      papers = data.resultList?.result || [];
      out.steps.push({
        step: '2_results',
        count: papers.length,
        sample: papers.slice(0, 2).map((p) => ({
          title: p.title,
          pmcid: p.pmcid,
          isOpenAccess: p.isOpenAccess,
          has_abstract: !!p.abstractText,
        })),
      });
    }
  } catch (e) {
    out.steps.push({ step: '1_search_failed', error: e.message });
  }

  if (!papers.length) {
    out.steps.push({
      step: '3_no_papers',
      note: 'Europe PMC returned 0 results for this query',
    });
    return json(out);
  }

  const openAccess = papers.find((p) => p.pmcid && p.isOpenAccess === 'Y');
  let textForClaude = '';
  if (openAccess) {
    out.steps.push({ step: '4_fulltext_target', pmcid: openAccess.pmcid });
    try {
      const idWithPrefix = String(openAccess.pmcid);
      const idNoPrefix = idWithPrefix.replace(/^PMC/i, '');
      const tries = [
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${idWithPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idNoPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idWithPrefix}/fullTextXML`,
      ];
      let ftRes = null;
      let ftUrl = '';
      for (const u of tries) {
        const r = await fetch(u);
        out.steps.push({ step: '5_fulltext_try', url: u, status: r.status });
        if (r.ok) {
          ftRes = r;
          ftUrl = u;
          break;
        }
      }
      if (!ftRes) {
        out.steps.push({ step: '5_fulltext_status', status: 'all_failed' });
        textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}`;
        throw new Error('all_failed');
      }
      out.steps.push({
        step: '5_fulltext_status',
        status: ftRes.status,
        ok: ftRes.ok,
        url: ftUrl,
      });
      if (ftRes.ok) {
        const xml = await ftRes.text();
        const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}\n\n--- FULL TEXT EXCERPT ---\n${text.slice(0, 5000)}`;
        out.steps.push({ step: '6_fulltext_length', chars: text.length });
      } else {
        textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}`;
      }
    } catch (e) {
      out.steps.push({ step: '5_fulltext_failed', error: e.message });
      textForClaude = `${openAccess.title}\n\n${openAccess.abstractText || ''}`;
    }
  } else {
    out.steps.push({
      step: '4_no_open_access',
      note: 'No Open Access paper in results',
    });
    const first = papers[0];
    textForClaude = `${first.title}\n\n${first.abstractText || ''}`;
  }

  try {
    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2500,
        system: `Extract chemical formulations from the text. Output ONLY a JSON array. Each item must have "name", "category", "form_type", "components" (array with name_en + percentage), "completeness" ("complete" or "partial"). If no formulation, return []. Be generous — partial recipes count.`,
        messages: [{ role: 'user', content: textForClaude.slice(0, 8000) }],
      }),
    });
    out.steps.push({ step: '7_claude_status', status: cr.status, ok: cr.ok });
    if (cr.ok) {
      const cd = await cr.json();
      const raw = cd.content?.[0]?.text || '';
      out.steps.push({ step: '8_claude_raw', text: raw.slice(0, 2000) });
      try {
        const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim());
        out.steps.push({
          step: '9_parsed',
          count: Array.isArray(parsed) ? parsed.length : 0,
          sample: Array.isArray(parsed) ? parsed.slice(0, 2) : null,
        });
      } catch (e) {
        out.steps.push({ step: '9_parse_failed', error: e.message });
      }
    }
  } catch (e) {
    out.steps.push({ step: '7_claude_failed', error: e.message });
  }

  return json(out);
}

/* ─── Provider clients ───────────────────────────────────────── */

async function searchProvider(provider, query, max) {
  try {
    if (provider === 'semantic_scholar') return await searchSemanticScholar(query, max);
    if (provider === 'pubmed') return await searchPubMed(query, max);
    if (provider === 'arxiv') return await searchArxiv(query, max);
    if (provider === 'lens') return await searchLens(query, max);
  } catch (_) {
    /* fall through to [] */
  }
  return [];
}

// Semantic Scholar — papers (free, no auth)
async function searchSemanticScholar(query, max) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${max}&fields=title,authors,abstract,year,venue,externalIds,url`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.data || [])
    .filter((p) => p.abstract)
    .map((p) => ({
      source_type: 'paper',
      external_id: p.externalIds?.DOI || p.externalIds?.CorpusId || p.paperId,
      title: p.title || 'Untitled',
      authors: (p.authors || []).map((a) => a.name).filter(Boolean).join(', ').slice(0, 400),
      abstract: p.abstract,
      year: p.year || null,
      journal_or_office: p.venue || null,
      url:
        p.url ||
        (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
    }));
}

// Europe PMC — papers (PubMed + PMC + full text where available)
async function searchPubMed(query, max) {
  const filteredQuery = `(${query}) AND HAS_FT:Y AND IN_EPMC:Y NOT (PUB_TYPE:"case-reports" OR PUB_TYPE:"editorial" OR PUB_TYPE:"comment" OR PUB_TYPE:"letter")`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(filteredQuery)}&format=json&pageSize=${max * 2}&resultType=core`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const data = await r.json();
  let results = data.resultList?.result || [];

  // Fallback: try without filter if empty
  if (!results.length) {
    const fallback = await fetch(
      `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${max}&resultType=core`,
      { headers: { Accept: 'application/json' } }
    );
    if (fallback.ok) {
      const fd = await fallback.json();
      results = fd.resultList?.result || [];
    }
  }
  if (!results.length) return [];

  // Dedupe by title (Europe PMC sometimes returns same paper from PubMed + PMC)
  const seenTitles = new Set();
  const dedupResults = results
    .filter((res) => {
      const titleKey = (res.title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 100);
      if (seenTitles.has(titleKey)) return false;
      seenTitles.add(titleKey);
      return true;
    })
    .slice(0, max);

  const items = dedupResults
    .map((res) => ({
      source_type: 'paper',
      external_id: res.doi
        ? `DOI:${res.doi}`
        : res.pmid
          ? `PMID:${res.pmid}`
          : res.pmcid || res.id,
      title: (res.title || 'Untitled').replace(/\s+/g, ' ').trim().slice(0, 400),
      authors: (res.authorString || '').slice(0, 400),
      abstract: res.abstractText || null,
      year: res.pubYear ? parseInt(res.pubYear) : null,
      journal_or_office:
        res.journalTitle || res.bookOrReportDetails?.publisher || null,
      url: res.doi
        ? `https://doi.org/${res.doi}`
        : res.pmid
          ? `https://pubmed.ncbi.nlm.nih.gov/${res.pmid}/`
          : null,
      _source_kind: res.source,
      _pmcid: res.pmcid || null,
      _is_oa: res.isOpenAccess === 'Y',
      _has_ft: res.hasFullText === 'Y' || res.hasPDF === 'Y',
      _in_epmc: res.inEPMC === 'Y',
    }))
    .filter((p) => p.abstract || p._pmcid);

  // For up to 5 OA papers with PMC ID, fetch full text
  const withPmc = items.filter((it) => it._pmcid && it._in_epmc).slice(0, 5);
  await Promise.allSettled(
    withPmc.map(async (it) => {
      const idWithPrefix = String(it._pmcid);
      const idNoPrefix = idWithPrefix.replace(/^PMC/i, '');
      const candidates = [
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${idWithPrefix}/fullTextXML`,
        `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC/${idNoPrefix}/fullTextXML`,
      ];
      let ftRes = null;
      for (const u of candidates) {
        try {
          const r = await fetch(u, { headers: { Accept: 'application/xml' } });
          if (r.ok) {
            ftRes = r;
            break;
          }
        } catch (_) {
          /* try next */
        }
      }
      if (!ftRes) return;
      try {
        const xml = await ftRes.text();
        const text = xml
          .replace(/<\?xml[^>]*\?>/g, '')
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const slice = sliceAroundKeywords(
          text,
          [
            'formulation',
            'composition',
            'preparation',
            'ingredients',
            'materials and methods',
            'recipe',
            'excipients',
            '%',
            'w/w',
            'w/v',
            'percentage',
            'mg/ml',
            'mass fraction',
          ],
          10000
        );
        if (slice && slice.length > 600) {
          it.abstract =
            (it.abstract || it.title) + '\n\n--- FULL TEXT EXCERPT ---\n' + slice;
        }
      } catch {
        /* ignore */
      }
    })
  );

  return items.filter((it) => it.abstract);
}

/** Pick a ~maxLen slice with the highest keyword density. */
function sliceAroundKeywords(text, keywords, maxLen) {
  if (!text || text.length <= maxLen) return text;
  const lower = text.toLowerCase();
  let bestPos = 0;
  let bestScore = 0;
  for (let i = 0; i < text.length; i += 1000) {
    const window = lower.slice(i, i + 4000);
    let score = 0;
    for (const k of keywords) {
      const m = window.match(new RegExp(k, 'g'));
      if (m) score += m.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPos = i;
    }
  }
  return text.slice(Math.max(0, bestPos - 500), bestPos + maxLen);
}

// arXiv — preprints
async function searchArxiv(query, max) {
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=${max}`;
  const r = await fetch(url);
  if (!r.ok) return [];
  const xml = await r.text();
  const entries = xml.split('<entry>').slice(1);
  return entries
    .map((e) => {
      const t = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/\s+/g, ' ').trim();
      const ab = (e.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.replace(/\s+/g, ' ').trim();
      const id = (e.match(/<id>([^<]+)<\/id>/) || [])[1];
      const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
      const auths = [...e.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
      return {
        source_type: 'preprint',
        external_id: id ? id.split('/').pop() : null,
        title: t || 'Untitled',
        authors: auths.join(', ').slice(0, 400),
        abstract: ab || null,
        year: pub ? parseInt(pub.slice(0, 4)) : null,
        journal_or_office: 'arXiv',
        url: id || null,
      };
    })
    .filter((p) => p.abstract);
}

// "Lens" via Crossref patents (best-effort fallback)
async function searchLens(query, max) {
  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent('patent ' + query)}&rows=${max}&filter=type:patent`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.message?.items || [])
      .map((it) => ({
        source_type: 'patent',
        external_id: it.DOI || (it.URL || '').split('/').pop(),
        title: (it.title?.[0] || 'Untitled patent').slice(0, 400),
        authors: (it.author || [])
          .map((a) => `${a.given || ''} ${a.family || ''}`.trim())
          .filter(Boolean)
          .join(', ')
          .slice(0, 400),
        abstract: it.abstract || null,
        year: it.created?.['date-parts']?.[0]?.[0] || null,
        journal_or_office: it.publisher || 'Patent',
        url: it.URL || null,
      }))
      .filter((p) => p.abstract);
  } catch {
    return [];
  }
}

/* ─── Claude extraction ──────────────────────────────────────── */

const EXTRACT_FROM_ABSTRACT_SYSTEM = `You are a chemistry-formula extraction system. You aggressively extract every chemical formulation hinted at in scientific text — papers, patents, methods sections.

YOUR JOB: For every formulation in the text, output one JSON object. Be GENEROUS — partial recipes are valuable. Only return [] if the text is purely theoretical with no ingredients mentioned at all.

Output ONLY a JSON array (no prose, no markdown fence). Each item:
{
  "name": "english product name from the text (e.g. 'WHO alcohol-based handrub formulation I')",
  "category": "one of: hair_care, skin_care, body_care, personal_hygiene, color_cosmetics, cleaning, disinfectants, laundry, dishwashing, automotive, industrial, agriculture, food_beverage, pet_care, adhesives, coatings, specialty, oral_care, water_treatment, pharmaceutical",
  "form_type": "liquid|gel|cream|powder|paste|aerosol|tablet|emulsion|other",
  "components": [
    {"name_en":"Ethanol","cas_number":"64-17-5","percentage":80.0,"function":"active"}
  ],
  "completeness": "complete|partial",
  "process_conditions": {"order_of_addition":"..."}
}

When to extract (be generous):
1. **Concrete recipe with %s**: extract as "complete" if sums to 95-105%, else "partial".
2. **Some ingredients with %s, others named without %**: extract as "partial". For each ingredient WITHOUT a %, estimate using typical industry values (e.g. surfactants 5-15%, preservatives 0.3-0.8%, fragrance 0.1-0.5%, water as remainder).
3. **Only ingredients named (no %s at all)**: STILL extract as "partial" — use typical % for each. The user is a chemist who can refine later.
4. **Multiple variants in one paper**: extract each as a separate formula.

Always:
- Use the actual product name from the text. Never invent brand names.
- Components must have name_en and percentage (estimate if not explicit). cas_number and function are optional but include when known.
- Cap at 5 formulas per response.
- Aim for components that sum to roughly 100%. If they're under, add water as remainder.

ONLY return [] if:
- The text is pure theory/review/policy with zero ingredients named
- The text discusses unrelated chemistry (e.g. theoretical kinetics, microbiology only)

Examples:

Text: "We tested the WHO formulation I containing ethanol 80% v/v, glycerol 1.45% v/v, hydrogen peroxide 0.125% v/v, water to 100%"
→ ONE formula: complete, 4 components (Ethanol 80, Glycerol 1.45, H2O2 0.125, Water 18.425)

Text: "Carbopol-based antiseptic gel containing chlorhexidine digluconate and triethanolamine was prepared..."
→ ONE formula: partial. Estimate: Carbopol 0.7%, Chlorhexidine 2%, Triethanolamine 0.7%, Water 96.6%

Text: "We studied antibiotic resistance in hospital staff."
→ [] (no formulation)

Be helpful — better to extract a partial formula a chemist can refine than to reject everything.`;

async function extractFromAbstract(src, env) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2500,
        system: EXTRACT_FROM_ABSTRACT_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `TITLE: ${src.title}\n\nABSTRACT:\n${src.abstract.slice(0, 6000)}`,
          },
        ],
      }),
    });
    if (!r.ok) return [];
    const cd = await r.json();
    const txt = (cd.content?.[0]?.text || '')
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```$/, '')
      .trim();
    const arr = JSON.parse(txt);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function countBy(arr) {
  const m = {};
  for (const k of arr) m[k] = (m[k] || 0) + 1;
  return m;
}
