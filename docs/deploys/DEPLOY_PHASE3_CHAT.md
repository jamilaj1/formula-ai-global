# 🚀 Phase 3 Deployment — Real AI Chat

This adds a real conversational AI page where users:
- Ask questions in any language
- The AI asks clarifying questions back
- The AI searches the database when needed
- The AI presents 1–3 best matches conversationally
- The AI can modify formulas on request
- All conversations are saved forever per user

---

## Step 1 — Run SQL in Supabase (1 minute)

Open:
```
https://supabase.com/dashboard/project/ivabcssceeaqgqjzgmdx/sql/new
```

Paste the entire contents of **`supabase_phase3_chat.sql`** and press **Run**.

It creates:
- `chat_sessions` table (one row per conversation)
- `chat_messages` table (one row per turn)
- RLS policies so each user only sees their own chats
- A trigger that bumps `updated_at` whenever a new message is added

---

## Step 2 — Update the Cloudflare Worker (3 minutes)

1. Open https://dash.cloudflare.com → Workers → `formula-ai-brain` → **Edit code**
2. Select all (Ctrl+A) → Delete
3. Paste the entire new `worker.js`
4. **Save and Deploy**

That's it — no new environment variables needed. The chat endpoint reuses `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`.

---

## Step 3 — Upload frontend files to Hostinger (2 minutes)

In Hostinger File Manager:

| File | Location | Action |
|---|---|---|
| `chat.html` | `public_html/` | Upload (new file) |
| `assets/chat-live.js` | `public_html/assets/` | Upload (new file) |

Both files are linked from the existing navigation if you upload `chat.html` first.

---

## Step 4 — Test (2 minutes)

Open an **incognito window**:
```
https://jamilformula.com/chat.html
```

### Try these queries to confirm the AI is reasoning, not just dumping lists:

1. `I need a hand sanitizer gel`
   → AI should ask: alcohol-based or alcohol-free? for adults or kids? quality vs. economy?

2. (after answering) `Alcohol-free, for kids, economical`
   → AI should call `search_formulas`, find candidates, and present 2–3 options conversationally with trust scores.

3. `Show me the second one`
   → AI should call `get_formula_details` and present the full formula with ingredients, percentages, CAS, source.

4. `Replace Triclosan with something natural`
   → AI should suggest a chemically-sound substitute with reasoning.

5. (Sign in first) `What did we talk about earlier?`
   → AI should remember previous turns within the session.

### Expected behavior

- Top-right pill shows your usage: e.g. `Free: 3/20`
- Sidebar shows your previous chats (after sign-in)
- Each AI message that mentions formulas shows clickable links to the formula detail page

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `claude_error` in chat | Check `ANTHROPIC_API_KEY` is still valid in Worker secrets |
| `session_create_failed` | Confirm `supabase_phase3_chat.sql` ran successfully |
| Chat doesn't remember previous messages | Confirm SQL ran (chat_messages table must exist) |
| Sidebar empty | Sign in — guest sessions are not listed |
| AI keeps asking the same question forever | Worker tool-use loop is capped at 5 rounds; if hit, it returns whatever text it has |

---

## What's next (Phase 4 + Phase 5)

After this works, we move to:

**Phase 4 — Formula modification UI**
- Side panel shows the "current formula" while you chat
- AI proposes changes; you approve/reject diff-by-diff
- Save modified versions to your library

**Phase 5 — Upload books / let it learn**
- Drag-drop PDF
- Worker calls Claude to extract formulas
- Auto-insert into `formulas` table with attribution
- Searchable + chat-able immediately
