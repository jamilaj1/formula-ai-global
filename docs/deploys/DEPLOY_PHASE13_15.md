# 🚀 Phase 13 + 14 + 15 — Library, Cost & Scaling

Three new capabilities, all in one page (`/library.html`):

1. **My Library** — view, edit, delete every formula you've saved
2. **Cost Calculator** — get total cost & per-kg cost for any formula at any batch size
3. **Production Scaler** — convert percentages into exact masses for batches of any size

---

## Step 1 — Run SQL (1 minute)

```
https://supabase.com/dashboard/project/ivabcssceeaqgqjzgmdx/sql/new
```

Paste `supabase_phase13_15.sql` and click **Run**.

Creates:
- `ingredient_prices` (per-user ingredient costs)
- RLS policies + updated_at trigger

---

## Step 2 — Deploy Worker (3 minutes)

Paste the new `worker.js` into Cloudflare → Edit code → Ctrl+A → Delete → Paste → **Deploy**.

Adds endpoints:
- `GET /library` — list saved formulas
- `GET /library/:id` — full detail
- `PUT /library/:id` — update
- `DELETE /library/:id` — remove
- `GET /prices` — your prices
- `POST /prices` — add/update a price
- `DELETE /prices/:id` — remove a price
- `POST /cost` — calculate cost for a formula
- `POST /scale` — scale to a target batch size

---

## Step 3 — Upload front-end (1 minute)

| File | Location |
|---|---|
| `library.html` | `public_html/` |
| `assets/library-live.js` | `public_html/assets/` |

---

## Step 4 — Test (3 minutes)

Sign in, then open `https://jamilformula.com/library.html`.

### Tab 1 — Formulas
- See every formula you've saved via AI Chat
- Click **View** to see the full ingredient list
- Click **Cost** or **Scale** to jump straight to that tool

### Tab 2 — Ingredient prices
- Add prices like: `Sodium Laureth Sulfate` · `2.50` · `USD`
- Add 5–10 of your most common ingredients
- They're remembered for every future calculation

### Tab 3 — Cost calculator
- Pick a formula (or paste a public UUID from `formulas.html?id=…`)
- Set batch size (e.g. `100` kg)
- Click **Calculate**
- See total cost, per-kg cost, ingredient-by-ingredient breakdown, and a list of any ingredients with no price set

### Tab 4 — Production scaler
- Pick a formula
- Set target batch (e.g. `200` kg)
- Pick unit (kg / g / L / mL)
- Click **Scale**
- Get exact masses for every ingredient — ready to weigh out

---

## Phase 16+ ideas

- **Public Library** — share favorite formulas with the community
- **PubChem auto-CAS** — fill in missing CAS numbers automatically
- **Recipe PDF export** — branded production sheets
- **Inventory** — track on-hand stock of each ingredient
- **Production schedule** — calendar of scheduled batches
- **Multi-user / Team** — companies with multiple chemists
