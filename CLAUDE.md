# Project rules — Formula AI Global (jamilformula.com)

## CRITICAL LANGUAGE RULES

1. **All code is in English ONLY.** Variable names, function names, comments, file names — everything in English. No Arabic in code.

2. **Site default language: English.** Every page renders in English by default. Visible text in HTML is English.

3. **Arabic is secondary, available only through the language toggle.** Arabic translations are stored exclusively via `data-i18n-ar="..."` attributes. The runtime swaps text when the user clicks the AR toggle.

4. **Pattern for bilingual content:**
   ```html
   <h1 data-i18n-ar="عنوان عربي">English title</h1>
   ```
   - The element's text content is the English version.
   - The `data-i18n-ar` attribute holds the Arabic translation.
   - Never put Arabic as the primary HTML content.

5. **For attributes (placeholder, title, etc.):**
   ```html
   <input data-i18n-attr="placeholder"
          data-i18n-placeholder-ar="نص عربي"
          placeholder="English text" />
   ```

6. **Dynamic / JavaScript-rendered content:** must be in English by default and use the same `data-i18n-ar` pattern when injected into the DOM.

7. **Database content:** All English. Arabic translations live in dedicated columns (e.g. `name_ar`, `description_ar`).

8. **Owner identity:**
   - Name: `Jamil Abduljalil` (NOT `Abduljaleel`)
   - Email: `jamilaj1@gmail.com`
   - Domain: `jamilformula.com`
   - **Experience: 25+ years in industrial chemistry across multiple countries.**
   - **Currently managing a chemical operation producing ~2,000 tons/month.**
   - **Founder and owner of DosLunas — own chemical plant producing 50+ tons/month.**
   - Total operational chemistry footprint under Jamil: **~2,050 tons/month**
     across multiple countries — a credential most R&D-only AI startups
     can't match. Use this as the credibility anchor on marketing copy.

9. **Style:** Professional, global. No country-specific assumptions in defaults. The site targets a worldwide audience.

10. **Coverage:** 195 countries, 40 industries. **Database has 3,381 verified
    formulas today**, target 200,000+ long-term. Marketing copy must reflect
    the real number (or a rounded honest version like "3,400+ verified
    formulas · growing daily") — never claim "200K+" as if already in the DB.

11. **Pricing reality (May 2026):**
    - Display: USD on pricing.html (`$25 / $50 / $125` per month for Pro/Business/Enterprise)
    - Backend charge: GHS via Paystack (`300 / 600 / 1500` GHS) at fixed 1 USD = 12 GHS
    - Paystack merchant account is Ghana-based and does NOT currently support USD billing.
      Pending: request USD enablement from Paystack support.

## Tech stack reminder

- Frontend: Static HTML/CSS/JS on Hostinger
- Database: Supabase (project `ivabcssceeaqgqjzgmdx`)
- AI Worker (Edge): Cloudflare Workers (`formula-ai-brain.jamilaj1.workers.dev`)
  - Source: `worker-src/` (modular ESM, ~16 files)
  - Bundled by esbuild → `worker.js` (~85 KB)
- AI Backend (Origin, Phase 1+): FastAPI + RDKit (deployed on Render/Fly.io)
  - Source: `backend/` (FastAPI + Python services)
  - Routes: `/api/chem/*` (real molecular property computation)
  - Worker proxies `/chem/*` → Python `/api/chem/*`
- Auth: Supabase Auth (Google OAuth + email/password)
- Payments: **Paystack** primary (live, GHS), Stripe legacy fallback (dormant)
- Languages supported via toggle: 12 (default English)
- Tests: vitest (Worker, 41 tests) + pytest (backend, 30+ chemistry tests)
- CI: GitHub Actions workflow in `.github/workflows/ci.yml`

## AI roadmap context

This is NOT a static chatbot. The platform is being built up in phases
toward a real industrial-chemistry AI:

- **Phase 1 (current):** RDKit-powered chemistry engine (compute_properties,
  canonicalize, Lipinski) via Python backend. Replaces LLM-guessing with
  computed values.
- **Phase 2:** PubChem similarity search + substructure matching (FAISS).
- **Phase 3:** Multi-agent reasoning (formulator, safety, cost, stability,
  regulatory, orchestrator).
- **Phase 4:** ML property-prediction models trained on user's data + PubChem.
- **Phase 5:** Continuous learning from new papers/patents.
- **Phase 6:** Vision (label/structure image → formula).

When discussing capabilities with the owner, distinguish honestly between
what ships TODAY (Phase 1) vs the long-term vision (Phase 6).
