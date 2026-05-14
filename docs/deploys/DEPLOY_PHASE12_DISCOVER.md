# 🌐 Phase 12 — Academic & Patent Discovery

The AI now reaches outside our database to find chemical formulations published in academic papers and patents around the world.

---

## What it does

1. You enter a chemistry topic (any language).
2. The Worker fans out to **4 free, public APIs** in parallel:
   - **Semantic Scholar** — 200M+ academic papers
   - **PubMed** — 36M+ medical / chemistry papers (NCBI)
   - **arXiv** — 2.4M+ chemistry preprints
   - **CrossRef Patents** — patent metadata
3. Aggregates and deduplicates results.
4. For each item with an abstract, Claude reads it and extracts any balanced chemical formulation.
5. Every extracted formula is saved to the database with full attribution (DOI / patent number, authors, year, journal).
6. They become searchable + chat-able immediately.

---

## Why not Google Scholar / Google Patents directly?

Google does not publish a public API for either service. Scraping their HTML violates their ToS and gets blocked quickly. The four sources we use cover the **same underlying papers + patents** — Google itself indexes them from these databases.

---

## Step 1 — Run the SQL (1 minute)

Open https://supabase.com/dashboard/project/ivabcssceeaqgqjzgmdx/sql/new

Paste the contents of **`supabase_phase12_discover.sql`** and press **Run**.

It creates:
- `discovery_jobs` — every Discover query you launch
- `discovered_sources` — every paper/patent we've seen
- adds `discovered_source_id` column to `formulas`

---

## Step 2 — Update the Worker (3 minutes)

Open https://dash.cloudflare.com → Workers → `formula-ai-brain` → **Edit code**.

1. Ctrl+A → Delete
2. Paste the entire updated `worker.js`
3. **Save and Deploy**

No new secrets needed — uses existing `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_KEY`.

---

## Step 3 — Upload front-end files to Hostinger (1 minute)

| File | Location |
|---|---|
| `discover.html` | `public_html/` |
| `assets/discover-live.js` | `public_html/assets/` |

---

## Step 4 — Test (3 minutes)

Open `https://jamilformula.com/discover.html` (sign in first).

Try these queries:

### Easy first test
```
antimicrobial hand sanitizer formulation
```
Pick all 4 sources, set "Per-source results" to 8, click Start discovery.

Wait 60–180 seconds. You'll see something like:
```
✓ Discovery complete
Sources searched: 25
Formulas added: 6
Providers used: 4
By source: semantic_scholar: 8 · pubmed: 8 · arxiv: 5 · lens: 4
```

### More targeted tests
- `liposomal vitamin C cosmetic emulsion`
- `silver nanoparticle antibacterial gel`
- `eco-friendly biodegradable laundry detergent`
- `mRNA lipid nanoparticle formulation`
- `ceramide moisturizer skin barrier repair`

---

## How extraction works

For every paper/patent abstract longer than 200 characters, Claude is given:
- the title
- the abstract (up to 6,000 chars)
- a strict prompt: "extract only formulations whose components sum to ~100%"

Claude returns a JSON array. Each item is validated:
- has a name
- has at least one ingredient
- ingredients sum to 95–105%

Items that pass are inserted into `public.formulas` with:
- `trust_score = 75` (extracted from abstract = lower confidence than your seed data)
- `source_title` / `source_author` / `source_year` / `source_url` from the paper/patent
- `discovered_source_id` link back to the source row
- `added_by_user_id` so you can see your contributions

---

## Cost per discovery run

- 4 API calls (free)
- ~25 abstracts → 25 Claude calls (~$0.001 each) → ~$0.025 per run
- Each saved formula then becomes searchable forever

Run 100 discovery jobs → about $2.50 in Claude usage → potentially hundreds of new formulas in your DB.

---

## Limits & caveats

- **Per-source max**: 20 results. Fanning out larger creates rate-limit risk on the public APIs.
- **CrossRef "patents"** is a partial source — full coverage of patent text needs **The Lens** API key (free tier: https://www.lens.org/lens/user/subscriptions). When you get one, set it in Worker secrets as `LENS_API_KEY` and we'll wire it in for the next phase.
- **Quality varies** — abstracts often *mention* a formula without giving exact percentages. Claude correctly skips those. Expected hit rate is 5-25% (i.e. for every 100 sources, 5-25 yield a real formula).
- **Cumulative growth** — every run adds new formulas. After a few weeks of regular discovery, your database will dwarf the original 3,381 seed.

---

## Phase 13 ideas (next)

- **Scheduled discovery** — cron job that runs your saved queries every week, auto-adding new papers
- **Watch a topic** — get email when N new formulas are extracted on a topic you care about
- **Lens.org full text** — extract from full patent claims, not just abstract
- **Citation graph** — when a paper is cited, also discover what cites it
- **PubChem cross-link** — auto-fill missing CAS by querying PubChem for each ingredient name

Tell me when you want to ship the next one.
