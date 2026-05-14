# 🚀 Phase 4 + 5 — Personal library + Book learning

This adds two big capabilities:

**Phase 4 — Modify & save**
- The chat AI can now save modified formulas to your personal library
- You ask: "replace Triclosan with something natural" → AI proposes a fix → you say "save it" → it's stored as YOUR version

**Phase 5 — Teach the AI from your books**
- Drag-drop a PDF (or paste text) on `learn.html`
- Claude reads it, extracts every balanced formula it finds
- Each extracted formula is saved to the database with full attribution (book title, author, year)
- They become searchable + chat-able immediately

---

## Step 1 — Run the SQL (1 minute)

Open https://supabase.com/dashboard/project/ivabcssceeaqgqjzgmdx/sql/new

Paste the entire **`supabase_phase4_5.sql`** and press **Run**.

It creates:
- `user_formulas` (your modified copies)
- `uploaded_books` (tracks each upload + extraction status)
- adds `uploaded_book_id` and `added_by_user_id` columns to `formulas`
- RLS policies + triggers

---

## Step 2 — Update the Worker (3 minutes)

Open https://dash.cloudflare.com → Workers → `formula-ai-brain` → **Edit code**.

1. Ctrl+A → Delete
2. Paste the entire new `worker.js`
3. **Save and Deploy**

No new secrets needed — uses the same `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`.

---

## Step 3 — Upload front-end files to Hostinger (2 minutes)

| File | Location | Action |
|---|---|---|
| `learn.html` | `public_html/` | Upload (new) |
| `assets/learn-live.js` | `public_html/assets/` | Upload (new) |

That's it — `chat.html` already has the new "save" capability via the updated worker.

---

## Step 4 — Test Phase 4 (Modify & Save) — 2 minutes

1. Sign in
2. Open `https://jamilformula.com/chat.html`
3. Have a chat that ends with a saved formula:

```
You: I need a hand sanitizer alcohol-free
AI:  [asks clarifying questions]
You: For kids, economical, gentle
AI:  [searches, presents 2-3 options]
You: Show me the second one
AI:  [shows full formula]
You: Replace Triclosan with Tea Tree Oil 0.5% — adjust water accordingly.
AI:  [proposes the change with reasoning, asks if you want to save]
You: Save it
AI:  ✓ Saved to your library as "Hand Sanitizer Gel — Tea Tree variant"
```

To verify the save:
- Open Supabase → Table Editor → `user_formulas` → you'll see your modified copy.

---

## Step 5 — Test Phase 5 (Teach the AI) — 3 minutes

1. Open `https://jamilformula.com/learn.html`
2. Drag a small PDF (1-3 pages of formulations) into the drop zone, or paste 1,000+ characters of recipe text
3. Fill **Title** (and optionally Author, Year)
4. Click **Extract formulas with AI**
5. Wait 30-90 seconds
6. You'll see: `✓ N formulas found · K added to database`
7. Open `https://jamilformula.com/chat.html` and ask the AI for a formula by name from your book — it'll find it.

The new formulas show up in:
- `/search` results
- `/chat` (when AI searches the DB)
- `formulas.html?id=…` direct link

---

## What gets skipped during extraction?

The Worker only inserts formulas where:
- `name` is not empty
- `components[]` has at least one ingredient
- Percentages sum between 95% and 105%

Discussions, partial recipes, theory chapters → safely skipped. Each skipped item is reported in the UI.

---

## Limits

- Max **60,000 characters** per extract call (~25 PDF pages of dense text). For larger books, run the extraction in chunks (paste different sections).
- Extraction uses your daily search-limit budget (1 chat = 1 unit; 1 extraction is free for now — you can wire it into the limiter later if you want).
- Free plan still has 20 chats/day — this is shared.

---

## Phase 6 ideas (next)

- **Library page** that lists `user_formulas` with edit/delete/share buttons
- **Public/Private toggle** — share your favorite modifications with the world
- **Formula DOI / patent search** — auto-pull from PubChem when CAS is missing
- **Cost estimator** — given current ingredient prices (manual or API), calculate batch cost in $/L
- **Production scaler** — "scale this to 200L batch" → see exact masses

Tell me when you're ready and which one to build first.
