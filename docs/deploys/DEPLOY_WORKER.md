# Deploying the Cloudflare Worker

The Worker source lives in `worker-src/` (modular ES modules). It is
bundled by esbuild into the single `worker.js` at the repo root, which
is the artefact Cloudflare runs.

There are **two equivalent ways** to deploy. Pick one.

---

## Option A — Wrangler CLI (recommended)

This is the modern, scriptable workflow. CI uses this.

### One-time setup

```bash
# From the repo root
npx wrangler login                # opens browser, authorise once
```

### Set secrets (one-time per environment)

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put PAYSTACK_SECRET_KEY
# Optional (only if Stripe is wired):
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Public (non-secret) vars are already in `wrangler.toml`. Add Paystack
plan codes the same way, or with `wrangler secret put` if you prefer.

### Deploy

```bash
npm run deploy:worker
# = npm run build:worker && wrangler deploy
```

Two minutes later your changes are live at
`https://formula-ai-brain.jamilaj1.workers.dev`.

### Verify

```bash
curl https://formula-ai-brain.jamilaj1.workers.dev/health
# {"status":"ok","service":"Formula AI Brain v8",...}
```

---

## Option B — Paste-into-dashboard (fallback)

For when you don't have CLI access or want to inspect the bundle visually.

### Steps

1. **Build the bundle locally:**
   ```bash
   npm run build:worker
   ```
   This writes `worker.js` at the repo root (~83 KB, one file).

2. **Open the bundle:**
   - File Explorer → `H:\FormulaAI-Backup-2026-05-11\worker.js`
   - Open in Notepad or VS Code
   - `Ctrl+A` then `Ctrl+C` (select all, copy)

3. **Cloudflare dashboard:**
   - https://dash.cloudflare.com → Workers & Pages → `formula-ai-brain`
   - Click **Edit code** (or Quick Edit)
   - Inside the code panel: `Ctrl+A` then `Ctrl+V`

4. **Verify the paste landed correctly:**
   - Scroll to the top — first line is the bundled module header.
   - Search (Ctrl+F) for `verifyPaystackSignature` — should be present.
   - Search for `handleSearch` — should be present.

5. Click **Save and Deploy**.

6. Verify with the same `curl /health` command as Option A.

---

## Smoke tests after every deploy

```bash
# 1. Health
curl https://formula-ai-brain.jamilaj1.workers.dev/health

# 2. Paystack webhook should reject unsigned POST (security)
curl -X POST https://formula-ai-brain.jamilaj1.workers.dev/paystack/webhook \
  -H "Content-Type: application/json" -d '{}'
# → "invalid signature" (status 401)

# 3. /scale should reject anonymous POST (auth gate)
curl -X POST https://formula-ai-brain.jamilaj1.workers.dev/scale -d '{}'
# → {"error":"auth_required"} (status 401)
```

If any of these fail, the deploy is broken — re-deploy or roll back.

---

## Rolling back

### Wrangler:
```bash
npx wrangler rollback
```

### Dashboard:
- Cloudflare Workers → `formula-ai-brain` → **Deployments** tab
- Find the previous version → **⋯** → **Rollback to this version**

### Last-resort (from local backup):
```bash
# Restore from one of the H:\ backups:
unzip H:\FormulaAI-Backup-2026-05-11_POST-SECURITY-2026-05-13.zip
npm run build:worker
npm run deploy:worker
```

---

## Local development

```bash
npx wrangler dev          # runs the Worker locally on http://localhost:8787
                          # with hot reload from worker-src/
```

This requires the same secrets to be set via:
```bash
# Create .dev.vars (gitignored) with non-secret dev values, or use:
npx wrangler dev --var ANTHROPIC_API_KEY=sk-ant-...
```

For pure offline testing without external services, run:
```bash
npm test                  # vitest with mocked fetch
```

---

## When something looks wrong

- **Bundle didn't update on Cloudflare**: confirm `worker.js` mtime is recent
  before deploying. If you forgot `npm run build:worker`, you uploaded stale code.
- **Tests fail after edits**: run `npm test` locally. It rebuilds the bundle
  and exercises every route.
- **Lint fails**: `npm run lint:fix` autofixes most issues.
- **Wrangler asks for a token**: use `npx wrangler login` (browser-based).

---

## CI/CD

`.github/workflows/ci.yml` runs lint + tests on every push. To enable
automatic deploys on push to `main`, add a `CLOUDFLARE_API_TOKEN` secret
to the GitHub repo (Settings → Secrets → Actions) and append:

```yaml
  deploy-worker:
    needs: [worker-js]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run deploy:worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Get the token at https://dash.cloudflare.com/profile/api-tokens with the
"Edit Cloudflare Workers" template.
