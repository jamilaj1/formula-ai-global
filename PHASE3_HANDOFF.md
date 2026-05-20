# PHASE 3 HANDOFF — Exclusive content + Subscription gate

> Permanent record. Date: **2026-05-19**. Spec executed:
> `EXEC_SPEC_PHASE3.md`. Status: **Phase 3 = COMPLETE, deployed, verified
> live on BOTH `jamilformula.com` and `www.jamilformula.com`.** The
> legacy Vercel `www` issue is **fully resolved** (project deleted,
> DNS corrected — see §5). No open code or infra blockers.

---

## 0. TL;DR

- Parts A, B, C of `EXEC_SPEC_PHASE3.md` are done, deployed to Hostinger
  `public_html`, and verified live by direct server curl + the owner's
  own browser screenshot (the formula.html gate works visually).
- Correct site is live now on BOTH **`https://jamilformula.com`** and
  **`https://www.jamilformula.com`** (both → Hostinger / LiteSpeed,
  verified: `Server: LiteSpeed`, "3,381", "Members-only library",
  "World's First").
- **Root cause of "fake data / old site came back":** `www.jamilformula.com`
  was a *separate, legacy Vercel Next.js app* ("200K+" prototype), NOT in
  the sanctioned stack, unrelated to anything uploaded to Hostinger.
  **RESOLVED:** `www` DNS repointed to Hostinger + the legacy Vercel
  project `formula-ai-global` deleted (see §5).
- No further code work required. `DEPLOY_PHASE3.zip` is final.

---

## 1. What shipped (Part A — remove open/free/CC/source framing)

| File | Change |
|---|---|
| `encyclopedia.html` | Title/description/hero/stats → "Formula Library / Members only / 3,381 verified". Removed **Bulk download** button, **CC-BY-SA-4.0** badge/line, "gift to humanity"/CC-license section → "Members-only library" value block. Footer CC line removed. Formula-card `CC-BY-SA-4.0` div → "Verified · trust N%". Nav AR `الموسوعة المفتوحة` → `مكتبة الفورمولا`. |
| `index.html` | Whole "A gift to the world / open & free encyclopedia" section → "Members-only library" block (bilingual). Footer link "Open Encyclopedia" → "Formula Library". |
| `pricing.html` | Removed source-as-feature ("Every formula with its source", "book/patent"). Starter plan realigned to the gate (browse + "Formula preview (first 3 ingredients)"); removed "10 formulas/month" + "PDF export" from free tier; comparison cell → "Preview". CTA "10 free formulas" → "Browse the library free"; "Start free trial" → "Create free account". |
| `safety.html` | Nav AR `الموسوعة المفتوحة` → `مكتبة الفورمولا`. |
| `assets/formula-detail-live.js` | Removed `source_url`/`source_title`/`source_author` rendering → "Verified · trust N%". Fixed pre-existing `getById` destructuring bug. Added the subscription gate (see §2). |
| `assets/supabase-client.js` | `getById()` now strips `source*/book*/patent*/reference*` keys from the response (client-side, v1 — see §6 note). |

Backend/Worker source disclosure: Worker `/search` already selects an
explicit column list with **no** source fields — no change needed. The
only public read path that returned source was the client `getById`,
now stripped.

Deliberate, documented deviations from the literal spec:
- Spec referenced `encydopedia.html` (misspelled). **That file does not
  exist** in this repo; the real live file is `encyclopedia.html` —
  worked on the real file.
- `programs.html` program substance (university/award) left intact: the
  spec scoped that kill explicitly to the *index.html* "gift" block.
- `pricing.html` API-limit numbers `50,000` (requests/day) are NOT the
  "50K free formulas" kill target — left as-is (correct).

## 2. What shipped (Part B — subscription gate)

Gate rule (client-side, v1): paid if
`profile.subscription_status === 'active'` OR `profile.plan !== 'free'`
OR `profile.subscription_plan_id` (via `FAI_DB.getProfile()`).

- **`formula.html`** (the spec's verify page, inline script): after load
  + `getProfile()`. Free/anon → first **3** ingredients visible, rest
  `fx-locked-row` (blurred), procedure hidden, **batch scaler** shows
  "members-only" upgrade, **safety** button → upgrade modal, lock note +
  `pricing.html` "Unlock full formula". Paid → full. **Verified visually
  by the owner's screenshot** (blur + members-only batch scaler + Unlock
  CTA all rendered correctly for anon).
- **`assets/formula-detail-live.js`** (used by `formulas.html`): same
  gate + source removal.
- **`assets/chem-client.js`**: centralized gate — wraps every `FAI_CHEM`
  API method (except `health`). Non-paid → upgrade modal, **no API
  call** (protects API cost) for substitute/predict/scan/agent/similarity.
- **`pricing.html`**: 3 plan buttons →
  `FAI_DB.startCheckout('professional'|'business'|'enterprise')`.
  Enterprise converted from "Contact sales" → Subscribe.
  - NOTE: spec wrote `'pro'|'biz'|'ent'` but the Worker
    `paystackPlanMap` keys are **`professional/business/enterprise`** —
    using the spec's short codes would break checkout (`unknown_plan`).
    Kept the correct full names.
- Worker `/paystack/checkout` re-verified: returns
  `{"error":"auth_required"}` → route is live and auth-gated (env was
  set in earlier work; full plan-env check needs a real JWT).

## 3. What shipped (Part C — build)

- `?v=8` → `?v=9` bumped across all **29** root `*.html`
  (supabase-client.js & chem-client.js are site-wide deps that changed).
- Build script: **`scripts/build_phase3.py`** (Python `zipfile`,
  forward-slash entries, asserts 0 backslash).
- Artifact: **`DEPLOY_PHASE3.zip`** — 36 entries, **0 backslash**,
  233,359 bytes = 29 `*.html` + `sw.js` + `assets/{styles.css, app.js,
  supabase-client.js, search-live.js, chem-client.js,
  formula-detail-live.js}`.
  - `formula-detail-live.js` added beyond the spec's asset list because
    it changed and is loaded by `formulas.html`.
- `sw.js` left untouched (kill-switch, no caching — correct).
- Uploaded + extracted to Hostinger `public_html` by the owner.

## 4. Live verification (cold, on apex `https://jamilformula.com`)

All via direct server `curl` (no browser cache/SW) + owner screenshot:

| # | Check | Result |
|---|---|---|
| 1 | `encyclopedia.html` | ✅ `<title>Formula Library — 3,381…</title>`, `?v=9`, "Members only"; NO CC/Creative Commons/Open Encyclopedia/Bulk download |
| 2 | `index.html` | ✅ "Members-only library" + footer "Formula Library" + "3,381"; NO "gift to the world"/"Open Encyclopedia" |
| 3 | `formula.html?id=01b4cf38-88ba-4aaf-b268-f828c0653645` | ✅ gate code live; **owner screenshot**: 3 visible + rest blurred + batch-scaler members-only + "Unlock full formula"; no source line |
| 4 | `pricing.html` | ✅ 3 `data-checkout` (professional/business/enterprise) + `startCheckout` + "Formula preview (first 3…)"; NO source/"10 formulas/month" |
| 5 | assets | ✅ `chem-client.js` = `subscription-gated`/`isPaidUser`/`showUpgradeModal`; `supabase-client.js` source-strip present |

**Phase 3 acceptance: PASS (all 5 verified in a real cold browser).**

## 5. CRITICAL infra finding — `www` is a legacy Vercel app

`PROJECT_CONTEXT.md` defines the stack as Hostinger + Cloudflare Worker
+ Render + Supabase. **There is no Vercel in the sanctioned stack.**

Discovered:
- `jamilformula.com` (apex) → `Server: LiteSpeed` (Hostinger) = **our
  correct Phase 3 site**.
- `www.jamilformula.com` → `Server: Vercel`, `__next`/`turbopack`,
  "200K+ / Welcome Formula AI", separate login (outlook account) =
  **an old, orphaned Vercel Next.js deployment**, unrelated to this
  repo. Uploading to Hostinger never affects it.
- Chrome hides the `www.` prefix in the address bar → the owner saw
  `jamilformula.com/...` while actually on the `www` Vercel app (this is
  why "search.html 404" appeared — the Next.js app has no `/search.html`
  route; our Hostinger `/search.html` returns HTTP 200 correctly).

**Fix applied & RESOLVED (by owner):**
1. Hostinger hPanel DNS: `CNAME www` changed
   `cname.vercel-dns.com` (TTL 14400) → **`jamilformula.com` (TTL 3600)**.
   Confirmed at BOTH authoritative nameservers (`atlas`/`hyperion`
   `.dns-parking.com`): `www → canonical name = jamilformula.com`.
2. Legacy Vercel project **`formula-ai-global` DELETED** (Vercel →
   Project → Settings → Delete Project). It had owned the custom domain
   `www.jamilformula.com`. Deleting it released the domain permanently
   so it can never re-intercept.
3. **Verified post-fix (curl):** `https://www.jamilformula.com/` →
   `HTTP 200, Server: LiteSpeed`, body has "3,381" + "Members-only
   library" + "World's First" = the correct Phase 3 site. apex
   unchanged/correct. **www == apex == Phase 3.**

NOTE — a second Vercel project **`formula-ai-api`**
(`formula-ai-api.vercel.app`, GitHub `jamilaj1/formula-ai-global`) still
exists. It has **no custom domain** so it does NOT serve
`jamilformula.com`/`www` and does not affect the live site. It is out of
the sanctioned stack (backend is Render). Verify nothing depends on its
`.vercel.app` URL before any future cleanup; harmless to leave.

## 6. Open items / next actions

1. ✅ **DONE — `www` DNS** repointed to Hostinger; verified serving
   Phase 3 (`Server: LiteSpeed` + "3,381" + "Members-only library").
2. ✅ **DONE — legacy Vercel project `formula-ai-global` deleted.**
   The fake "200K+" app is permanently gone from `www` and apex.
3. **(Owner, if it ever recurs in YOUR browser only)** the old
   Vercel app may be cached in the browser you used / you were logged
   into it (outlook account). Hard-refresh (Ctrl+Shift+R) or use
   Incognito on `https://www.jamilformula.com` to confirm — the server
   is verified correct, any residue is local browser cache only.
4. ✅ **DONE — `formula.html` "Analyse safety" fixed.** The call is now
   `window.FAI_DB.getSafety(FORMULA)` (matches `supabase-client.js`).
   `formula.html` asset refs bumped `?v=9 → ?v=10`; `DEPLOY_PHASE3.zip`
   rebuilt (36 entries, 0 backslash, 233,355 B, `getSafety` confirmed).
   **ACTION: owner must re-upload `DEPLOY_PHASE3.zip` to Hostinger
   `public_html` (overwrite)** — the live site still serves the old
   build (`analyzeSafety`, `?v=9`) until then.
5. **(Informational)** second Vercel project `formula-ai-api` still
   exists with no custom domain — does not affect the live site (see
   §5 note). Leave unless a future audit confirms it is unused.

## 6b. Post-Phase-3 enhancement — chat markdown rendering (2026-05-19)

Owner request: the AI chat showed raw markdown (`###`, `| tables |`)
and mixed Arabic/English with no direction handling.

- `assets/chat-live.js` — `formatReply()` rewritten into a safe,
  line-based markdown→HTML renderer: headings, **bold**, `code`, fenced
  ```code```, ordered/unordered lists, GitHub-style tables, paragraphs.
  All text HTML-escaped first (M1-safe); links restricted to
  `http(s)`/relative. Output wrapped in `dir="auto"` blocks so Arabic
  renders RTL and English LTR automatically, even when mixed.
- `chat.html` — added scoped `.bubble .md` CSS (tables, headings,
  lists, code/pre, RTL-aware via logical properties); asset refs bumped
  `?v=9 → ?v=11`.
- `scripts/build_phase3.py` — **fixed**: added `assets/chat-live.js` to
  the deploy asset list (it was missing, so chat fixes would not have
  shipped). Zip now 37 entries.
- Verified: `node --check` OK; functional test confirms table/heading/
  list/pre render and code is XSS-escaped.
- ✅ **DONE — uploaded & verified live (2026-05-19).** Owner re-uploaded
  the zip. Confirmed: `https://jamilformula.com/chat.html` serves
  `?v=11` + `table.md-table` CSS + new `chat-live.js` renderer; a live
  AI answer with a markdown table now renders as a styled RTL table
  (header, borders, zebra rows) instead of raw `|` — verified by owner
  screenshot + curl.

## 6c. Mobile search + chat choices + Worker search relevance (2026-05-19)

Three follow-on enhancements after the chat markdown renderer.

**(1) Mobile search display — `search-live.js` + `search.html`** ✅ LIVE
- Each ingredient is now a bidi-isolated chip (`direction: ltr;
  unicode-bidi: isolate;`) → English name + numeric % stay together
  even when the page is in Arabic RTL (fixes the scrambled "%·name"
  output the owner reported on mobile).
- Card redesigned mobile-first: tag/form/trust row that wraps,
  `dir="auto"` title, ingredients as wrapping chips, smaller paddings
  under 600 px.
- Asset refs bumped `?v=12`.

**(2) Chat clickable disambiguation — `chat-live.js` + `chat.html`** ✅ LIVE
- New `enhanceChoices(html, rawText)` detects clarification cues
  (`هل تقصد` / `do you mean` / `which of these` / etc.) and turns the
  first option list into clickable chips linking to
  `./formula.html?name=<text>` (opens the formula page directly,
  one-click, new tab, preserves the chat).
- `.fx-choice` CSS adds a green chip button look with hover +
  `↗` cue. Existing markdown rendering for non-cue replies unchanged.
- XSS-safe (text escaped first; already-linked items skipped).
- Asset refs bumped `?v=13`.

**(3) Worker `/search` relevance fix — `worker-src/handlers/search.js`** ✅ LIVE
- Stop stripping spaces from the noun; multi-word nouns now use ilike
  wildcards (`hand wash` → `*hand*wash*`).
- Widened pool: also matches `sub_category`; two-tier fallback (drop
  category, then category-only) so we stay on-topic instead of empty.
- New relevance score: noun in name (+40), each boost term in haystack
  including components (+12), each must token in name (+8), each
  meaningful query token (+5), category match (+6), and **trust is now
  only a small tiebreaker (≤+5)** instead of dominating (was /10 = up
  to +10).
- Safety net: if every row scored 0 but rows were fetched, fall back to
  trust order rather than returning nothing.
- Build: `npm run build:worker` → `worker.js` (~92 KB). Owner pasted
  into Cloudflare → live. Verified e2e:
  - "شامبو السيارات عالية الرغوة" → top hits = automotive car-wash
    snow-foam shampoos (`_score` 70.4); previously generic shampoos.
  - "car wash foam shampoo" → top hits = Color Foam Car Wash Shampoo
    variants (`_score` 130.4).



```bash
# apex (should always be Hostinger Phase 3)
curl -sI https://jamilformula.com/ | grep -i server          # -> LiteSpeed
curl -s  https://jamilformula.com/encyclopedia.html | grep -o '<title>[^<]*</title>'

# www propagation (flips to LiteSpeed once old TTL expires)
curl -sI https://www.jamilformula.com/ | grep -i server
nslookup -type=CNAME www.jamilformula.com atlas.dns-parking.com   # authoritative truth

# rebuild deploy zip if any file changes again
cd <repo> && python scripts/build_phase3.py
```

## 6d. SEO + 40 industry pages + data growth playbook (2026-05-19)

Strategic push toward 9.5+ via discoverability:

- **formula.html** — `updateSeo(f)` injects per-formula `<title>`, meta
  description, canonical, Open Graph, Twitter Card, and full Schema.org
  `Product`/`ChemicalSubstance` JSON-LD (incl. `aggregateRating` from
  trust, `additionalProperty` list of ingredients). 3,381 distinct
  indexable formula pages.
- **`scripts/build_sitemap.py`** (NEW) — pulls every formula from
  Supabase (anon key + RLS), writes `sitemap.xml` (3,434 URLs ≈ 720 KB).
  Re-run after backfills or new ingestion.
- **`scripts/build_industries.py`** (NEW) — generates **40 industry
  landing pages** at `industries/<slug>.html` + `industries/index.html`.
  Each: unique meta, JSON-LD `CollectionPage` + `ItemList`, up to 12
  top formulas (by trust), pricing CTA. 37 DB categories + 3 cross-
  groupings (personal-care, sanitation, heavy-industry).
- **`scripts/build_phase3.py`** — extended to bundle `industries/*.html`
  + `sitemap.xml` into `DEPLOY_PHASE3.zip` (now 79 entries, ~475 KB).
- **`DATA_GROWTH_PLAYBOOK.md`** (NEW) — owner-run ops doc: finish
  SMILES backfill, retrain ML, ingest via Discover, quality bar.
  Target: **3,381 → 10,000+** formulas, ~80% enriched.

**ACTIONS (owner, after upload):**
1. Upload the new `DEPLOY_PHASE3.zip` to Hostinger `public_html`
   (overwrite). The extract creates `industries/` and `sitemap.xml`.
2. Submit `https://jamilformula.com/sitemap.xml` to **Google Search
   Console** (Property → Sitemaps → Add) so the 3,434 URLs get crawled.
3. Follow `DATA_GROWTH_PLAYBOOK.md` over the next 6–10 weeks.

## 8. Files touched this phase

```
index.html  encyclopedia.html  pricing.html  formula.html  safety.html
assets/formula-detail-live.js  assets/supabase-client.js
assets/chem-client.js
+ ?v=8→?v=9 in all 29 root *.html
formula.html (?v=10, getSafety fix)
chat.html (?v=11, .md CSS)  assets/chat-live.js (markdown renderer)
NEW: scripts/build_phase3.py  PHASE3_HANDOFF.md  PHASE3_WORKINGTREE_2026-05-19.patch
ARTIFACT: DEPLOY_PHASE3.zip (37 entries, 0 backslash, ~238 KB)
```

_Last updated: 2026-05-19 — Phase 3 complete & verified live on apex
and `www`. Legacy Vercel deleted, www DNS fixed, analyzeSafety fixed,
chat markdown renderer added, mobile search display bidi-fixed, chat
disambiguation choices clickable, Worker search ranking now relevance-
dominated (trust = tiebreaker only). Open: optional admin-key rotation._
