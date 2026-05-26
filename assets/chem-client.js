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

/* ─── Subscription gate ─────────────────────────────────────────────
   The chemistry tools (substitute / predict / scan / agent / similarity)
   are members-only. For non-paid users we DO NOT call the API — we show
   an upgrade modal instead (cheap, honest, protects API cost). */
let _paidCache = null;
async function isPaidUser() {
  if (_paidCache !== null) return _paidCache;
  try {
    if (!window.FAI_DB || !window.FAI_DB.getProfile) return false; // unknown → treat as not paid
    const profile = await window.FAI_DB.getProfile();
    _paidCache = !!(profile && (
      profile.subscription_status === 'active' ||
      (profile.plan && profile.plan !== 'free') ||
      profile.subscription_plan_id ||
      (Number(profile.pro_credits_months || 0)
        > Number(profile.pro_credits_used || 0))
    ));
  } catch (_) { _paidCache = false; }
  return _paidCache;
}

function showUpgradeModal() {
  if (document.getElementById('fai-gate-modal')) return;
  const ar = (document.documentElement.lang === 'ar');
  const bg = document.createElement('div');
  bg.id = 'fai-gate-modal';
  bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px;';
  bg.innerHTML =
    '<div style="background:var(--bg-2,#111);border:1px solid var(--border,#333);border-radius:18px;padding:30px 32px;max-width:420px;text-align:center;">' +
      '<div style="font-size:2.4rem;margin-bottom:8px;">🔒</div>' +
      '<h3 style="margin:0 0 10px;">' + (ar ? 'أداة للأعضاء فقط' : 'Members-only tool') + '</h3>' +
      '<p style="color:var(--text-2,#aaa);margin:0 0 20px;font-size:.92rem;line-height:1.6;">' +
        (ar ? 'هذه الأداة متاحة للمشتركين فقط. اختر خطة لفتح كل الأدوات.' : 'This tool is available to members only. Choose a plan to unlock all tools.') +
      '</p>' +
      '<a href="./pricing.html" class="btn btn-primary" style="margin:4px;">' + (ar ? 'اعرض الخطط' : 'View plans') + '</a>' +
      '<button class="btn btn-ghost" id="fai-gate-close" style="margin:4px;">' + (ar ? 'لاحقاً' : 'Maybe later') + '</button>' +
    '</div>';
  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  const c = document.getElementById('fai-gate-close');
  if (c) c.addEventListener('click', () => bg.remove());
}

// Wrap every API method (except health) with the gate.
const _GATED = Object.keys(FAI_CHEM).filter((k) => k !== 'health');
const FAI_CHEM_GATED = { ...FAI_CHEM };
for (const name of _GATED) {
  const original = FAI_CHEM[name];
  FAI_CHEM_GATED[name] = async function (...args) {
    if (!(await isPaidUser())) {
      showUpgradeModal();
      return { error: 'members_only', _gated: true };
    }
    return original.apply(FAI_CHEM, args);
  };
}

window.FAI_CHEM = FAI_CHEM_GATED;
console.info('[FAI_CHEM] loaded — chemistry API client ready (subscription-gated)');
