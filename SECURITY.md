# Security policy — Formula AI Global

## Reporting a vulnerability

If you find a security issue in **jamilformula.com** or the AI Worker,
please email **jamilaj1@gmail.com** with the subject line
`SECURITY: <short description>`.

**Do not** open a public issue, post on social media, or share PoC code
publicly until we've had a chance to respond.

We aim to acknowledge reports within **72 hours**, and to patch critical
issues within **14 days**. We will credit researchers in a public
acknowledgement (with permission) once a fix ships.

## Scope

In scope:

- `jamilformula.com` and all subdomains
- `formula-ai-brain.jamilaj1.workers.dev` (the Cloudflare Worker)
- The Supabase project (`ivabcssceeaqgqjzgmdx.supabase.co`)
- Any code in this repository (HTML/JS/Worker/backend Python/SQL)

Out of scope:

- DoS / volumetric attacks (we use Cloudflare's standard protections)
- Social engineering of staff
- Issues in third-party dependencies that we can only forward upstream
  (we'll still want to know, but please file with them first)

## What we treat as a vulnerability

- Account takeover (auth bypass, session hijack, JWT mishandling)
- Privilege escalation (e.g. starter → enterprise without payment)
- Cross-tenant data leakage (one user's library readable to another)
- RLS bypass on Supabase tables
- Webhook signature bypass on `/paystack/webhook` or `/stripe/webhook`
- Prompt injection that exfiltrates user data or system prompts
- Stored XSS in formula names, chat messages, or uploaded book content
- CSRF on state-changing endpoints
- Server-side request forgery via the discovery endpoints
- Hard-coded secrets in shipped code

## What we are aware of and tracking

These are known limitations being addressed; please do not file them as
new reports unless you've found a meaningful escalation:

- [ ] CORS is currently `*` on the Worker; we plan to restrict to
      `https://jamilformula.com` + the staging origins.
- [ ] The frontend `SUPABASE_ANON` is filled in at build time, not
      committed as a placeholder.
- [ ] Rate-limit constants in `worker.js` are the single source of truth.
      Mismatches with marketed limits on `pricing.html` are tracked as
      bugs, not vulnerabilities.

## Out-of-band

If the issue affects user money flow (Stripe / Paystack), prefix the
subject line with `SECURITY-BILLING:` and we'll triage immediately.
