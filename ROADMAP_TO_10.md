# 🎯 ROADMAP TO 10/10 — Formula AI Global

> The honest plan to take the project from "impressive infrastructure" to
> a **proven 10/10 business**. Synthesised from an external strategic
> review (2026-06) + ground-truth knowledge of the live codebase.
>
> **Core thesis:** the engineering is essentially done (9.6/10). The gap to
> 10/10 is **clarity, distribution, and traction** — not more features.
> The discipline from here is: *stop building, start proving.*
> Companion to BUILD_ROADMAP.md (phase log) and PROJECT_CONTEXT_2026-06-01.md.

---

## ✅ Progress log (2026-06-01)

Shipped this push-cycle (all live, 210/210 tests):
- **A1** outcome-centric homepage hero + single CTA · fabricated
  testimonials hidden.
- **A3** outcome-led headers on tool pages (search/calculators/agent/similarity).
- **A4** enterprise.html reframed to outcomes (cost/quality/speed/compliance).
- **C4** Open Graph + Twitter cards on consulting/enterprise/pricing/about/
  industries (FB-shared links now show a proper preview).
- **B4** viral loop surfaced: share buttons on formula.html + "Earn free
  Pro" referral banner on the dashboard.
- **D3** real testimonial capture (submit → owner moderate → publish).
- **E3** sign-ups time-series chart in the Financials dashboard.
- Earlier: full growth kit (10 video scripts, 12 FB posts, welcome.html,
  /stats/community counter, UTM tracking).

Owner migrations pending (graceful-degrade until run): testimonials +
signups_by_day. Still owner-only: record videos, post on FB, collect real
testimonials, global supplier roster.

Remaining AI-buildable (next candidates): E5 client-side error tracking,
E2 real docs page, D2 activation tracking, E1 mobile QA, F2 enterprise
leave-behind PDF.

C1 SEO — DATA FINDING (2026-06-01): `chemicals_database` is **empty**
(0 rows; the "~7,000" in old docs was stale). `scripts/build_chemicals.py`
is built + ready and CORRECTLY produces zero pages from an empty table
(quality gate = no thin spam). Per-chemical SEO is therefore GATED on
populating `chemicals_database` first — e.g. via the existing PubChem
admin backfill (`/api/admin/...`). Until then, the only data-backed SEO
option is per-formula teaser pages from the real 3,381 `formulas`
(paywall-safe: name/category/trust/ingredient-count + CTA), which is a
weaker, more uniform set — owner to choose: populate chemicals first
(richer, recommended) vs ship formula teasers now.

---

## 0. Honest scorecard — where we are vs 10/10

| Dimension | Now | Target | The gap to close |
|---|---|---|---|
| Idea / concept | 9.8 | 10 | already excellent — keep |
| Technology / architecture | 9.6 | 10 | minor polish (mobile QA, docs, charts) |
| Chemistry specialization | 10 | 10 | the moat — protect it |
| **UX clarity (outcome-centric)** | **5** | 10 | homepage + every page must sell the *outcome*, not the *feature* |
| **Marketing / content** | **4** | 10 | kit is ready; needs execution + an ongoing content engine |
| **Distribution** | **4** | 10 | FB launch → LinkedIn → quality SEO → referral loop |
| **Traction (users / MRR / retention)** | **2** | 10 | the real gap: 7 users, ~$0 MRR today. Earned by execution. |
| **Social proof** | **2** | 10 | needs real users → testimonials → case studies |
| **Enterprise readiness** | **7** | 10 | outcome-framed B2B page + onboarding + outreach kit |
| **SEO** | **3** | 10 | quality data-backed pages (NOT thin AI spam) |

**Weighted reality:** the product is launchable and strong; the business is
unproven. Every item below is about converting strength into proof.

---

## 1. The one-line thesis

> **Shift from a 90%-engineering company to a 70%-distribution company.**
> Target effort mix from now: ~40% content · 30% SEO/distribution ·
> 20% enterprise outreach · 10% engineering polish.

---

## 2. WORKSTREAM A — Clarity & outcome positioning  *(mostly buildable now, not blocked on owner)*

The #1 fix. The site is *impressive* but not *clear*. Every visitor must
answer in 5 seconds: "what do I gain?"

| # | Item | Now | Definition of done (10/10) | Owner | Effort |
|---|---|---|---|---|---|
| A1 | **Homepage hero → outcome-centric** | "world's first AI chemical platform" (feature/ego) | Hero = "Build better chemical formulas, faster" + 3 outcomes (cut R&D time / lower cost / improve results) + 1 CTA | AI builds, owner approves copy | 2h |
| A2 | **Homepage section order** | feature list | Hero → How it works → Industries → Formula engine → Case studies → Enterprise → Testimonials → CTA | AI | 4h |
| A3 | **Per-tool outcome headers** | "AI Chat", "Smart Search" | each tool page leads with the benefit ("Find a substitute in seconds — save a stalled production line") | AI | 3h |
| A4 | **Enterprise page → outcomes** | capability cards | lead with Cost Reduction · Quality · Speed-to-market · Compliance · Supplier Intelligence (factories buy outcomes, not AI) | AI builds, owner adds real proof | 3h |
| A5 | **One clear primary CTA everywhere** | mixed CTAs | every page funnels to "Start free" → register (welcome.html exists) | AI | 1h |

**A is the highest ROI and almost entirely buildable now.**

---

## 3. WORKSTREAM B — Distribution machine  *(kit READY, execution is the owner's)*

Already built this session: `marketing/VIDEO_SCRIPTS.md` (10 videos),
`marketing/FACEBOOK_POSTS.md` (12 posts), `welcome.html` (campaign LP),
`/stats/community` (live counter), UTM tracking → admin Signups.

| # | Item | Now | Definition of done | Owner | Effort |
|---|---|---|---|---|---|
| B1 | **Facebook launch (60k audience)** | not started | 12 posts over 4 weeks, native video, UTM-tagged, replies in first hour | **Owner** (record + post) | ongoing |
| B2 | **LinkedIn daily framework** | not started | 30 post templates in owner's voice; 5/week | AI drafts from owner's 3 samples | content-blocked |
| B3 | **Content engine (blog)** | none | weekly "formulation mistake / tip / case" article; repurpose to FB+LinkedIn | AI drafts, owner reviews | needs go-ahead |
| B4 | **Referral loop** | EXISTS (5 verified formulas = 1 Pro month) | surface it louder: post-register banner + share buttons on results | AI | 3h |
| B5 | **YouTube Shorts** | none | repurpose the 10 videos vertical | Owner posts | low effort |

**Bottleneck:** B is not a building problem — it's a *posting* problem.
The tools are done; the owner's voice + cadence is the fuel.

---

## 4. WORKSTREAM C — Quality SEO engine  *(buildable, WITH guardrails)*

⚠️ **Guardrail (from the roadmap DO-NOT list):** NO thin AI-generated
pages. Google penalises them since 2024. The external review's "thousands
of pages / SEO monster" is right on *opportunity*, dangerous on *execution*.

**The right play:** we own real data — 3,381 verified formulas + ~7,000
chemicals + 40 industries. Generate pages backed by REAL data, not LLM
filler. A page per chemical with actual RDKit/PubChem properties is an
asset; a page of generated paragraphs is spam.

| # | Item | Now | Definition of done | Owner | Effort |
|---|---|---|---|---|---|
| C1 | **Per-chemical pages (data-backed)** | none | template + script over `chemicals_database`; each page = real properties (MW, logP, CAS, uses, safety) + internal links. Quality-gated, sitemap'd, rolled out in batches | AI builds, owner approves sample | 1-2 days |
| C2 | **Per-industry hub upgrade** | 40 pages exist | enrich each with real formula counts, common ingredients, troubleshooting from our data | AI | 1 day |
| C3 | **Troubleshooting / Q&A pages** | none | "why does my X separate?" backed by chemistry, not filler — start with 20 high-intent queries | AI drafts, owner verifies chemistry | needs go-ahead |
| C4 | **Technical SEO** | sitemap exists | meta/OG per page, schema.org (Product/FAQ), fast LCP, internal linking | AI | 1 day |

**Rule:** ship SEO pages in **quality batches**, monitor Search Console,
never dump 7,000 thin pages at once.

---

## 5. WORKSTREAM D — Traction & proof  *(execution → earned over time)*

The dimension that's genuinely at 2/10. Cannot be "built" — must be earned.
But we can instrument it so it compounds.

| # | Item | Now | Definition of done | Owner | Effort |
|---|---|---|---|---|---|
| D1 | **Launch → first 1,000 users** | 7 users | FB campaign live; admin Signups climbing; UTM showing best channel | Owner executes | weeks |
| D2 | **Activation tracking** | signups counted | measure: % who run a first chat/search within 24h (the "aha") | AI adds event tracking | 4h |
| D3 | **Testimonial capture** | none | in-app prompt after a "win"; collect 5-10 real quotes | AI builds prompt, owner collects | 3h + time |
| D4 | **Case studies** | none | 2-3 real before/after stories (a factory that cut cost / time) | Owner sources, AI writes | content-blocked |
| D5 | **Retention loop** | none | weekly "new formulas in your industry" email digest (Resend) | AI builds, owner approves | 1 day |

**Honest note:** investors ask MRR/retention/CAC. The dashboard (9.5)
measures them; the *numbers* come only from D1-D5 execution.

---

## 6. WORKSTREAM E — Technical polish to 10/10  *(AI, no blocker)*

The few real gaps that move tech 9.6 → 10.

| # | Item | Now | Definition of done | Effort |
|---|---|---|---|---|
| E1 | Mobile QA pass | desktop-first | every page verified on 360px width; navbar/forms/modals clean | 1 day |
| E2 | `docs.html` / API page | thin | real getting-started + endpoint reference (enterprise asks for it) | 1 day |
| E3 | Financials time-series | point-in-time | signups/MRR-over-time chart in admin | 0.5 day |
| E4 | Embedding auto-refresh | one-shot backfill | trigger re-embeds a formula when name/components change | 0.5 day |
| E5 | Client-side error tracking | server only | `window.onerror` → Sentry; catch real-user breakage | 0.5 day |
| E6 | Lighthouse / LCP polish | good | 90+ on mobile; defer fonts, optimise hero | 0.5 day |

---

## 7. WORKSTREAM F — Enterprise traction  *(mix)*

Factories buy cost/quality/speed/compliance — never "AI."

| # | Item | Definition of done | Owner |
|---|---|---|---|
| F1 | Enterprise page reframed to outcomes (= A4) | ROI-led, not feature-led | AI |
| F2 | One-page enterprise PDF (leave-behind) | outcomes + compliance + security + pricing | AI drafts |
| F3 | Outreach list + template | 40 target factories + a cold-email/LinkedIn script in owner's voice | Owner sources, AI writes |
| F4 | Teams onboarding polish | invite → seats → shared library flow tested end-to-end | AI |
| F5 | Procurement marketplace (Phase 8) | GLOBAL supplier roster + quote form + commission tracking | needs owner's supplier roster |

---

## 8. 90-day sequenced plan

**Weeks 1-2 — CLARITY (don't post into a vague site):**
- A1-A5 homepage + pages reframed to outcomes (AI).
- E1 mobile QA. B4 referral loud + share buttons.

**Weeks 3-6 — LAUNCH & MEASURE:**
- B1 Facebook 12-post campaign (owner). D2 activation tracking.
- Watch admin Signups → first real traction numbers.
- D3 testimonial capture turned on.

**Weeks 7-10 — COMPOUND:**
- C1-C4 quality SEO pages in batches (AI). D5 retention email.
- B2 LinkedIn framework (once owner gives 3 voice samples).
- First case study (D4) from an early power user.

**Weeks 11-13 — ENTERPRISE & PROOF:**
- F1-F3 enterprise outcome page + leave-behind + outreach to 40 factories.
- E2 docs page. Investor-ready metrics snapshot from the dashboard.

---

## 9. Who does what (the honest split)

**AI can do now, unblocked (just say go):** A1-A5, B4, C1-C2, C4, D2-D3
(build), D5, all of E, F1-F2, F4. — This is ~70% of the list.

**Needs the owner (no one else can):**
- Record the 10 videos (face/voice in #1, #9; screen for the rest).
- Post on Facebook + reply (B1). Provide 3 LinkedIn voice samples (B2).
- Supply REAL testimonials/case studies (D3-D4, never fabricated).
- Verify chemistry on troubleshooting SEO pages (C3).
- Provide the GLOBAL supplier roster + commission % (F5).
- Approve copy/positioning in his voice (A1, F3).

---

## 10. Definition of "10/10" (measurable exit criteria)

The project is 10/10 when ALL are true:
- [ ] Homepage states the outcome in 5 seconds (A1) — not the feature.
- [ ] 1,000+ registered users, with a known best acquisition channel.
- [ ] Activation > 40% (new users who run a chat/search in 24h).
- [ ] 5+ real testimonials + 2 case studies live.
- [ ] MRR is a real, climbing number on the dashboard (not $0).
- [ ] 3+ enterprise leads in the pipeline (real factories).
- [ ] Quality SEO pages indexed + bringing organic signups (Search Console).
- [ ] Mobile Lighthouse 90+, docs page real, no client errors in Sentry.
- [ ] Effort mix is ~40% content / 30% SEO / 20% enterprise / 10% dev.

**Today: ~2 of 9 met. The path above closes the rest — and almost none of
it is "build a better product." It's prove, position, distribute.**

---

_The biggest risk is NOT technical. It's staying in build-mode when the job
is now to launch, measure, and tell the story. The product is ready. Go._
