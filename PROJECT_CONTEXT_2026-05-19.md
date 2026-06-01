# PROJECT_CONTEXT — Formula AI Global (authoritative, 2026-05-19)

> Single source of truth. Older PROJECT_CONTEXT*.md kept for history but
> THIS file is current. Hand to any new session FIRST. Nothing below is
> aspirational — it is the verified state.

## 0. The golden rules (owner-mandated, never break)
1. **Don't delete/replace working things** — add beside, with fallback.
2. **No phase proceeds until verified in a COLD real browser.** Don't
   claim — prove.
3. **No fabricated numbers.** Use only real figures (see §4). Honesty in
   BOTH directions (admit when my diagnosis was wrong too).
4. Verify the live reality before AND after every change (assumptions
   caused the biggest mistakes).

## 1. Architecture (DECIDED & VERIFIED — do not re-litigate)
- **Canonical = static site** at `jamilformula.com`, hosted on
  **Hostinger** (`public_html`, LiteSpeed, IP 82.29.189.92).
- A separate **React/Vite app** (`~/Desktop/formula-ai/`) + its 2nd
  Supabase DB (`uwxvpdnahwdugrcfebbb`) were **DELETED by the owner**.
  Do NOT resurrect them. The static site superseded them.
- **ONE Supabase project**: `ivabcssceeaqgqjzgmdx` ("formula-ai-db",
  org jamilaj1 PRO, EU-West/Ireland, NANO compute).
- **Cloudflare Worker**: `formula-ai-brain.jamilaj1.workers.dev`
  (proxies search/chem/agents/vision; Paystack; forwards JWT).
- **Backend**: Render `formula-ai-chem.onrender.com` (FastAPI + RDKit +
  PubChem + 6 agents + Vision + 3 trained ML models). Render
  auto-deploys from GitHub `jamilaj1/formula-ai-global` (branch main).

## 2. Deploy model (frontend is MANUAL — the only manual step)
- Build ZIP with **Python `zipfile`** (forward-slash arcnames — never
  PowerShell `Compress-Archive`, it writes `\` and Hostinger makes junk
  files). All root `*.html` + `sw.js` + changed `assets/*`.
- Owner uploads to Hostinger File Manager → `public_html` → Extract →
  delete zip. That is the ONLY manual deploy action.
- **Cache-busting**: every asset ref carries `?v=N`. Currently **v9**
  (`styles.css?v=9` etc.). On any asset change → bump N everywhere it
  appears in changed files.
- **`sw.js` = KILL-SWITCH** (self-unregisters, clears caches, NO fetch
  handler). `assets/app.js` does NOT register a SW and does NOT
  reload-on-controllerchange. **Never re-add SW caching** — it caused
  stale-page + ~1s reload-loop disasters.
- `.htaccess` (5+ days old): HTTPS force + clean URLs
  (`/x`→`/x.html`) + `ErrorDocument 404 /index.html`. It is correct —
  **do not touch**.

## 3. Bugs FIXED & cold-verified (Phase 0 + 1 complete)
- formula.html: FAI_DB race (added `whenDbReady` poll) **and**
  `assets/supabase-client.js` queried non-existent `master_formulas`
  → fixed to `formulas`. **This was total breakage** — now COLD-VERIFIED
  loading a real 14-ingredient formula (id
  `01b4cf38-88ba-4aaf-b268-f828c0653645`).
- Service-worker reload loop ("screen moves every second") → killed.
- Navbar overlap on multi-item pages → hamburger ≤1280px, premium
  glass single row >1480px (in `styles.css`).
- White-on-white `<select>` dropdowns → global dark `option` CSS.
- Premium typography (Inter-led, smoothing) + hero clears fixed navbar.
- Homepage stats → honest labels + REAL counters (3381/132/900/20,
  animate on scroll — the "0" in text snapshots is pre-scroll, NOT a
  bug). Dashboard fake stats (42/100, 387, "Professional plan") →
  honest zeros + "Free plan".

## 4. REAL data (ground truth — use these, never invent)
- `formulas`: **3,381** total · chem-enriched **~900** (only ~27%).
- `imported_formulas`: 189 (owner Excel) → **132 verified** + 57
  rejected junk. The 132 are the trusted set.
- `chemicals_database`: **0 — EMPTY**. (So any "7K chemicals" /
  "200,000" / "50,000 formulas" marketing copy is FALSE — must be
  fixed; similarity.html still wrongly says "7K-chemical database".)
- `user_submissions`: exists, RLS, fed by contribute.html.
- Languages **20**. Backend ML: logp_rf (R²≈0.88), compatibility_rf
  (AUC≈0.89), stability_rf (R²≈0.86) — trained, live on Render.

## 5. Key files of record
- 5 tool pages: substitute / scan / agent / predict / similarity.html
- `formula.html` (formula presentation — now has paywall CSS scaffold:
  `.fx-locked-row`, `.fx-upgrade`, `.fx-modal` — Phase 3 in progress)
- `contribute.html` (+ `backend/ingestion/` pipeline, schemas)
- `assets/`: styles.css, app.js, supabase-client.js (v7, real anon key,
  `getById`→`formulas`), chem-client.js, search-live.js
- `backend/`: ml/ (registry, features, predictors, train_*), ingestion/
  (fb + excel + submissions + triage), services/observability.py
- **`EXEC_SPEC_PHASE3.md`** ← the precise plan for the NEXT work.
- Older: PROJECT_CONTEXT.md / PROJECT_CONTEXT_*.md (history only).

## 6. NEXT — Phase 3 (do this next; spec is written)
Execute **`EXEC_SPEC_PHASE3.md`** fully in a clean session:
- **A. Exclusive content**: remove ALL "Open / CC-BY-SA / free to
  humanity / Bulk download / Free for universities / source
  disclosure" from encydopedia.html, index.html "gift to the world"
  section, footer ("Open Encyclopedia"→"Formula Library"), formula
  cards/pages (hide source), and the API (`source_url`). Owner
  decision: everything EXCLUSIVE, no source revealed.
- **B. Subscription gate**: leverage existing Supabase `profiles`
  (subscription/paystack cols) + wired `startCheckout()` + pricing.html.
  Free = locked formula (3 ingredients + blur + upgrade CTA), no tools;
  Paid = full. Gate tool pages with an upgrade modal.
- **C. Build ZIP, owner uploads, COLD-verify all 5 checks.**
- Also fix inflated copy ("7K chemicals", any "50,000/200,000").

## 7. Deferred / non-blocking
ADMIN_API_KEY value on Render (metrics/admin locked but secure),
Better Stack account+token, finish SMILES backfill (>2,389 unenriched),
Liquid.xlsx import, mobile QA, Render NANO→bigger before 60k launch.

## 8. Accounts / IDs
GitHub `jamilaj1/formula-ai-global` (main) · Render `formula-ai-chem`
(srv-d82osao3kofs73d1didg) · Cloudflare worker `formula-ai-brain`
(Jamilaj1@gmail.com) · Supabase `ivabcssceeaqgqjzgmdx` · Hostinger
u680581922 root `public_html` · Paystack live GHS · Anthropic
`claude-haiku-4-5` · Owner: Jamil Abduljalil, 25+ yrs industrial
chemistry, ~2,000 t/mo ops + DosLunas 50+ t/day, 60k+ FB followers
(audience for launch — they judge from minute one).

## 9. Honest status line
Phases 0+1 done & cold-verified (site stable, navbar clean, formula
page loads real data, honest numbers, premium look). Phase 2 partial
(dashboard honest; marketing inflation in some pages still pending).
Phase 3 (exclusivity + paywall = the revenue engine) specced, not yet
built. The platform went from "broken/cheap" to "stable/clean/honest"
— proven, not claimed. Revenue not live until Phase 3 ships.
