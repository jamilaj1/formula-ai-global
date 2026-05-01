# Formula AI Global — Setup Guide

This is the one-time setup needed to take the deployed site from "loads" to
"fully working".

## 1. Push the latest code

From PowerShell on your Windows machine:

```powershell
cd C:\Users\Laptop\Desktop\formula-ai-global
git push origin main
```

Vercel picks up `origin/main` automatically and rebuilds.

## 2. Configure Vercel environment variables

Go to **Vercel → your project → Settings → Environment Variables** and set:

| Name | Value | Required for |
|------|-------|--------------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` from https://console.anthropic.com/settings/keys | `/search`, `/upload` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` (default) or `claude-opus-4-6` | optional override |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` | `/login`, `/register`, `/history` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (anon, not service_role) | `/login`, `/register`, `/history` |

After saving, click **Redeploy** in the Deployments tab so the new env vars are
picked up.

## 3. Run the database schema

Open **Supabase Studio → SQL Editor**, paste the entire contents of
[`database/schema.sql`](./database/schema.sql), and click **Run**. This creates:

- `profiles` — extended user info (one row per signup, auto-created via trigger)
- `search_history` — every AI query the signed-in user runs
- `saved_formulas` — formulas the user has explicitly saved
- `uploaded_books` — PDFs the user has processed

Each table has Row-Level Security enabled, so users can only see their own rows.

The script is **idempotent**: safe to re-run if you change the schema later.

## 4. Verify the site

After redeploy:

1. Open `https://jamilformula.com/` — homepage should render.
2. Toggle the sun/moon icon — light/dark should both work.
3. Switch language to Arabic — UI should flip RTL.
4. Click **Search** → search for `liquid soap` — Claude should return a formula.
5. Click **Sign up** → create a test account → confirm email → sign in.
6. Search again, then visit `/history` — your search should be saved.
7. Click **Upload Book** → drop in any chemistry PDF → formulas should be
   extracted as JSON.

If any step fails, check **Vercel → Deployments → Functions** for runtime logs.

## 5. Common issues

- **`ANTHROPIC_API_KEY not configured on server`**: variable is missing in
  Vercel, or you didn't redeploy after setting it.
- **Supabase auth fails silently**: the `NEXT_PUBLIC_SUPABASE_*` vars are wrong
  or the email confirmation link in Supabase Auth settings doesn't match
  `https://jamilformula.com`.
- **`/api/upload` times out**: PDFs over ~4.5 MB will fail on Vercel's free tier
  serverless body limit. Compress the PDF or upgrade the plan.
- **`/history` shows "search_history table not found"**: you haven't run
  `database/schema.sql` yet (step 3).

## 6. Optional: local development

```powershell
cd C:\Users\Laptop\Desktop\formula-ai-global\frontend
copy .env.local.example .env.local
# Edit .env.local and paste your real keys
npm install
npm run dev
```

Open http://localhost:3000.
