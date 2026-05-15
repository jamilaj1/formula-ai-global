/* ──────────────────────────────────────────────────────────────────────────
   chem-client.js — frontend wrapper for the chemistry endpoints.
     • /chem/properties, /chem/lookup/{name,cas}, /chem/similarity, …
     • /agents/evaluate, /agents/formulate, /agents/run/{name}
     • /vision/label, /vision/structure, /vision/msds
   All requests go through the Cloudflare Worker, which proxies to the
   Python (RDKit) backend. Auth is forwarded so rate-limits apply.
   ────────────────────────────────────────────────────────────────────────── */
const WORKER_URL = "https://formula-ai-brain.jamilaj1.workers.dev";

async function authHeaders() {
  const h = { 'Accept': 'application/json', 'Content-Type': 'application/json' };
  try {
    if (window.FAI_AUTH && window.FAI_AUTH.client) {
      const { data: { session } } = await window.FAI_AUTH.client.auth.getSession();
      if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    }
  } catch (_) { /* anonymous is fine */ }
  return h;
}

async function callPost(path, body) {
  try {
    const r = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: 'parse_failed', raw: text.slice(0, 300) }; }
    if (!r.ok) return { _http_status: r.status, ...data };
    return data;
  } catch (err) {
    return { _http_status: 0, error: 'network', detail: err.message };
  }
}

async function callGet(path) {
  try {
    const r = await fetch(`${WORKER_URL}${path}`, { headers: await authHeaders() });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { error: 'parse_failed', raw: text.slice(0, 300) }; }
  } catch (err) {
    return { error: 'network', detail: err.message };
  }
}

const FAI_CHEM = {
  // ─── Chemistry properties ──────────────────────────────
  properties: (smiles)         => callPost('/chem/properties',        { smiles }),
  canonicalize: (smiles)       => callPost('/chem/canonicalize',      { smiles }),
  lipinski: (smiles)           => callPost('/chem/lipinski',          { smiles }),
  solubility: (smiles)         => callPost('/chem/solubility',        { smiles }),
  toxicityScan: (smiles)       => callPost('/chem/toxicity_scan',     { smiles }),
  toxicityFormula: (formula)   => callPost('/chem/toxicity_scan_formula', formula),
  stabilityPredict: (formula)  => callPost('/chem/stability_predict', formula),

  // ─── PubChem lookup ────────────────────────────────────
  lookupByName: (name)         => callPost('/chem/lookup/name',       { name }),
  lookupByCas:  (cas)          => callPost('/chem/lookup/cas',        { cas }),

  // ─── Similarity + substitution ─────────────────────────
  similarity: (a, b)           => callPost('/chem/similarity',        { a, b }),
  findSimilar: (querySmiles, candidates, opts = {}) =>
    callPost('/chem/find_similar', {
      query_smiles: querySmiles,
      candidates,
      limit: opts.limit ?? 20,
      min_similarity: opts.minSimilarity ?? 0.3,
    }),
  findSubstitute: (target, candidates, opts = {}) =>
    callPost('/chem/find_substitute', {
      target,
      candidates,
      require_same_function: opts.requireSameFunction !== false,
      mw_tolerance: opts.mwTolerance ?? 0.3,
      limit: opts.limit ?? 5,
    }),
  substructure: (smarts, smiles) =>
    callPost('/chem/substructure', { smarts, smiles }),
  conflictCheck: (components)  => callPost('/chem/conflict_check', { components }),

  // ─── Multi-agent reasoning ─────────────────────────────
  agentEvaluate: (formula, opts = {}) =>
    callPost('/agents/evaluate', {
      formula,
      regions: opts.regions ?? ['EU', 'US'],
      prices: opts.prices ?? [],
      batch_kg: opts.batchKg ?? 1.0,
    }),
  agentFormulate: (request, opts = {}) =>
    callPost('/agents/formulate', {
      ...request,
      regions: opts.regions ?? ['EU', 'US'],
      prices: opts.prices ?? [],
      batch_kg: opts.batchKg ?? 1.0,
    }),
  agentRun: (name, payload) => callPost(`/agents/run/${name}`, payload),

  // ─── Vision ─────────────────────────────────────────────
  visionLabel:     (imageBase64) => callPost('/vision/label',     { image: imageBase64 }),
  visionStructure: (imageBase64) => callPost('/vision/structure', { image: imageBase64 }),
  visionMsds:      (imageBase64) => callPost('/vision/msds',      { image: imageBase64 }),

  // ─── Health ─────────────────────────────────────────────
  health: () => callGet('/chem/health'),
};

window.FAI_CHEM = FAI_CHEM;
console.info('[FAI_CHEM] loaded — chemistry API client ready');
