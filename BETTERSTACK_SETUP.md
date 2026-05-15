# Better Stack Setup — Formula AI Global

This file documents the one-time setup for Better Stack monitoring across
the platform. The integration code is already wired up in:

- `backend/services/observability.py` — installed in `main.py`
- `worker-src/observability.js` — wraps the Worker fetch handler

When `BETTER_STACK_TOKEN` is unset, both files silently no-op, so local
development keeps working without an account.

## What Better Stack gives us

| Component | What it does | Endpoints we use |
|---|---|---|
| **Telemetry (Logs)** | Receives every error + slow request from Render + Cloudflare. Searchable. Alerts on patterns. | `POST https://in.logs.betterstack.com` (Bearer token) |
| **Uptime** | Pings `/health` every 30s from 5 regions. Pages us if down for 60s. | HTTP probes |
| **Status Page** | Public `status.jamilformula.com` showing uptime + incidents. | Subdomain CNAME |

Plan: **Team — $25/month** (covers all three components).

---

## Step 1 — Create the account

1. Open **https://betterstack.com** → Sign up with your work email.
2. Verify email, then choose **Team plan** ($25/month).
3. Workspace name: `Formula AI Global`.

---

## Step 2 — Create three Telemetry Sources

In Better Stack → **Telemetry** → **Sources** → **Connect source**:

### 2a. FastAPI backend

- **Source name:** `formula-ai-backend`
- **Platform:** Python → FastAPI
- Copy the **Source token** that appears (looks like `Z9q2RxV...`).
- Add to **Render → formula-ai-chem → Environment**:
  ```
  BETTER_STACK_TOKEN     = <paste token>
  BETTER_STACK_HOST      = https://in.logs.betterstack.com
  SERVICE_NAME           = formula-ai-backend
  SERVICE_ENV            = production
  ```
- Click **Save changes** on Render — it will redeploy with the new env.

### 2b. Cloudflare Worker

- **Source name:** `formula-ai-worker`
- **Platform:** Cloudflare Workers
- Copy the Source token.
- Add to **Cloudflare → Workers & Pages → formula-ai-brain → Settings → Variables and Secrets**:
  - `BETTER_STACK_TOKEN` = `<paste token>` (mark as **Secret**)
  - `SERVICE_NAME` = `formula-ai-worker` (Text)
  - `SERVICE_ENV` = `production` (Text)
- **Deploy** the Worker after the build is updated (we already rebuilt
  `worker.js` to 89.8 KB with observability wrapped in).

### 2c. Frontend (optional — only if we add client-side error tracking later)

Skip for now. Add when we want to capture browser JS errors.

---

## Step 3 — Create Uptime monitors

In Better Stack → **Uptime** → **Create monitor**:

| Monitor name | URL | Check every | Expected | Alert after |
|---|---|---|---|---|
| Marketing site | `https://jamilformula.com` | 30s | 200 | 1 min down |
| Worker health | `https://formula-ai-brain.jamilaj1.workers.dev/health` | 30s | 200 + body contains `"status":"ok"` | 1 min |
| Backend health | `https://formula-ai-chem.onrender.com/health` | 30s | 200 + `"status":"ok"` | 1 min |
| Backend deep | `https://formula-ai-brain.jamilaj1.workers.dev/chem/health` | 60s | 200 | 2 min |
| Auth/Supabase | `https://ivabcssceeaqgqjzgmdx.supabase.co/rest/v1/` | 60s | 200 | 2 min |

For each: **Notification policy** → "On-call" → your email + phone SMS.

---

## Step 4 — Create the status page

Better Stack → **Status pages** → **Create status page**:

- **Title:** Formula AI Global Status
- **Subdomain:** `formula-ai-global` (gives you `formula-ai-global.betteruptime.com`)
- **Custom domain:** `status.jamilformula.com` (optional, free with Team plan)
- **Resources to include:** all 5 monitors from Step 3
- **Theme:** Dark, brand color `#00ff88` (matches our site)

### Connect custom domain (optional)

In Cloudflare → DNS for `jamilformula.com`:

```
Type: CNAME
Name: status
Target: status-pages.betteruptime.com
Proxy: OFF (DNS only)
```

In Better Stack status page settings → add `status.jamilformula.com` →
wait ~5 min for DNS propagation → SSL cert auto-issues.

---

## Step 5 — Create alerts

Telemetry → **Alerts**:

| Alert name | Query | Notify when | Notify whom |
|---|---|---|---|
| 5xx burst | `level:error AND status:>=500` | More than 5 in 1 min | On-call |
| Slow request | `duration_ms:>3000` | More than 10 in 5 min | Email only |
| Worker exception | `service:formula-ai-worker AND level:error` | Any | On-call |
| Backend exception | `service:formula-ai-backend AND level:error` | Any | On-call |
| Payment failure | `path:/paystack/* AND status:>=400` | Any | On-call (high priority) |

---

## Step 6 — Verify it's working

After Render and Cloudflare have redeployed with the new env vars:

```bash
# Trigger a 200 then a 404 then an intentional error
curl https://formula-ai-chem.onrender.com/health
curl https://formula-ai-chem.onrender.com/does-not-exist
curl -X POST https://formula-ai-chem.onrender.com/api/chem/properties \
     -H 'content-type: application/json' \
     -d '{"smiles": ""}'

# Inspect counters
curl https://formula-ai-chem.onrender.com/metrics/summary
curl https://formula-ai-chem.onrender.com/health/detailed
```

In Better Stack → **Telemetry** → **Live tail** you should see one
log line per request within 2-3 seconds. The 200 on `/health` is
filtered out by default (low-noise heuristic — see `observability.py`),
but the 404 and the bad-SMILES request will appear.

---

## What ships, what doesn't

We intentionally don't log:
- 200/OK pings to `/health`, `/`
- Successful 2xx responses to anything (we count them, but don't ship)

We always ship:
- Any 4xx response (validation failures, auth failures)
- Any 5xx response (server errors)
- Any uncaught exception with full stack trace
- Any request slower than 3 seconds
- Service startup events

This keeps the Better Stack quota low (well under the 30 GB/month
included in the Team plan even at 100K requests/day).

---

## Future: client-side errors

When ready, add to every HTML page:

```html
<script>
  window.addEventListener('error', (e) => {
    fetch('https://formula-ai-brain.jamilaj1.workers.dev/error_report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: e.message, source: e.filename, line: e.lineno,
        col: e.colno, stack: e.error?.stack, ua: navigator.userAgent,
        url: location.href,
      }),
    }).catch(() => {});
  });
</script>
```

And add a `/error_report` handler in the Worker that calls
`shipLog(env, { ...body, level: 'error', source: 'browser' })`.
