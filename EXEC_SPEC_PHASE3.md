# EXEC SPEC — Phase 3: Exclusive content + Subscription gate

> Self-contained. A fresh session executes this top-to-bottom, builds ONE
> deploy ZIP, then verifies in a cold browser. No prior context needed.
> Owner decision (final): formulas are PROPRIETARY/EXCLUSIVE to the site.
> NO "open / free / Creative Commons / bulk download / source disclosure".
> Stack of record: static site (Hostinger public_html) + Supabase
> `ivabcssceeaqgqjzgmdx` + Cloudflare Worker + Render. Deploy = build ZIP
> with Python `zipfile` (forward-slash), user uploads+extracts to
> public_html. Asset cache-bust: bump every `?v=8` → `?v=9` in changed
> files (sw.js is already a kill-switch — keep it).

## PART A — Remove all "open/free/CC/source" framing

Search the repo for these strings and remove/replace EVERYWHERE they
appear (grep first to get the file list; expect: `index.html`,
`encydopedia.html` (note the misspelled filename — that IS the live
file), `encyclopedia.html`, footer block in all ~30 root *.html,
`programs.html`, `about.html`, `docs.html`):

| Kill / phrase | Replace with |
|---|---|
| `CC-BY-SA-4.0`, `Creative Commons`, `CC-BY-SA` (badges, cards, text) | remove the badge/line entirely |
| "Open Chemistry Encyclopedia" / "Open Encyclopedia" | "Formula Library" |
| "released free to humanity", "Free for the world", "anyone can use, modify, and share", "A gift to the world" | "Exclusive verified formulations — members only" |
| "Bulk download" button/link | DELETE the element entirely (no mass export) |
| "Free for universities", "$10,000 yearly award", "Gold Standard certificates" open block (index.html "gift to the world" section) | Replace whole section with a "Members-only library" value block (verified, exclusive, growing) — NO free/open wording |
| Any "50,000 / 50K free formulas" | real number, no word "free": "3,381 verified formulas · growing" |
| Any visible **source** of a formula (book title / patent / "from <reference>") on formula cards & `formula.html` | remove the source line; show only "Verified · trust N" |
| Footer link `Open Encyclopedia` (every page) | rename to `Formula Library` → points to `encydopedia.html` |

Footer is identical block across pages → do it via a subagent
(mechanical, one replacement string) like the earlier navbar task.

Also in `backend/services/*` / worker: if any API returns a `source` /
`source_url` field for formulas, stop sending it to the public client
(or null it in the response shaping) so the source isn't disclosed via
API either. Grep backend for `source_url`, `source`, `book` in the
formula serialization path.

## PART B — Subscription gate (the revenue engine)

Foundation already exists (verified in Phase 0): Supabase `profiles`
table has `subscription_plan_id, subscription_status, plan,
formulas_used_this_month, has_export, has_advanced_search, has_no_ads,
has_white_label, paystack_customer_code…`. Paystack checkout is already
wired in `assets/supabase-client.js` (`startCheckout(plan)` → Worker
`/paystack/checkout`) and `pricing.html` exists.

Implement the GATE (client-side enforcement is fine for v1; the real
data lives behind the Worker which already forwards the JWT):

1. **Free tier (no/anon account):** can browse the library list +
   search, but the full `formula.html` shows ingredients **locked** —
   first 3 ingredients visible, rest blurred with an upgrade CTA. No
   batch-scaler, no safety analysis, ads shown.
2. **Signed-in free:** same as above + can `contribute.html`.
3. **Paid (Professional/Business/Enterprise):** full formula, batch
   scaler, safety, export, no ads.
   - In `formula.html`: after loading the formula, call
     `FAI_DB.getProfile()` (already exists). If
     `profile.subscription_status==='active'` (or plan != free) →
     render full. Else → render the locked/blurred version + a
     `<a href="./pricing.html">Unlock full formula</a>` and keep the
     existing premium-lock note.
   - Gate the tool pages (substitute/predict/scan/agent/similarity):
     if not paid, show the page but on submit show an upgrade modal
     instead of calling the API (cheap, honest, protects API cost).
4. **pricing.html:** ensure the 3 plan buttons call
   `window.FAI_DB.startCheckout('pro'|'biz'|'ent')` (Paystack live).
   Verify the Worker `/paystack/checkout` env (`PAYSTACK_SECRET_KEY`,
   `PAYSTACK_PLAN_PRO/BIZ/ENT`) are set in Cloudflare (they were, per
   earlier work — re-verify with one curl).
5. Honest copy on pricing: real features only, no fabricated stats.

## PART C — Build + verify (the discipline gate)

1. Bump changed-file asset refs `?v=8`→`?v=9`.
2. Build `DEPLOY_PHASE3.zip` (Python zipfile, fwd-slash, all *.html +
   sw.js + assets/{styles.css,app.js,supabase-client.js,
   search-live.js,chem-client.js}). 0 backslash entries.
3. User uploads+extracts to public_html (only manual step).
4. COLD browser verify (new tab):
   - encydopedia.html: NO "CC/open/free/Bulk download", NO source.
   - index.html: "gift to the world" section gone/reframed.
   - formula.html (real id `01b4cf38-88ba-4aaf-b268-f828c0653645`):
     locked for free, full for paid; NO source line.
   - pricing.html: plan button → Paystack checkout opens.
   - footer: "Formula Library" (not "Open Encyclopedia").
5. Do NOT mark Phase 3 done until all 5 verified in a real cold browser.

## Known real numbers (use these, never fabricate)
formulas total **3,381** · owner-verified **132** · chem-enriched
**~900** · languages **20**. Backend/ML live on Render. SW = kill-switch
(do not re-add caching). `.htaccess` (clean URLs + 404→index) is fine,
do not touch. PWA flicker + white-select + navbar bugs already fixed.

## Why this order
Removing "free/open/bulk-download" BEFORE shipping the paywall is
mandatory — selling a subscription while the same page offers the
content free under Creative Commons destroys the business. Part A
unblocks Part B.
