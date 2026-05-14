# Contributing — Formula AI Global

> Internal workflow doc. The project is closed-source today; this guide is
> for the owner and any future collaborators.

---

## Project rules

Before touching code, read [`CLAUDE.md`](./CLAUDE.md). The hard rules:

1. **All code in English** — variables, comments, file names.
2. **HTML default text is English** — Arabic lives only in `data-i18n-ar`.
3. **Owner name is `Jamil Abduljalil`** (not "Abduljaleel").

---

## Local setup

```bash
# JS / Worker tooling
npm install

# Python / backend tooling
python -m venv backend/venv
backend/venv/Scripts/Activate.ps1     # PowerShell on Windows
# or: source backend/venv/bin/activate
pip install -r backend/requirements.txt
pip install ruff
```

---

## Day-to-day commands

```bash
npm test            # run Vitest on worker.js
npm run test:watch  # watch mode
npm run lint        # ESLint
npm run lint:fix    # ESLint with autofix
npm run format      # Prettier write
npm run format:check  # Prettier check (CI uses this)

pytest backend/tests          # backend tests
ruff check backend scripts    # backend lint
ruff format backend scripts   # backend format
```

CI runs all of these on every push to `main`. PRs are blocked if any fail.

---

## Branch + commit conventions

- `main` is always deployable. Don't push broken code.
- Feature branches: `feat/<short-name>` (e.g. `feat/cost-estimator`).
- Bugfix branches: `fix/<short-name>`.
- Phase work: `phase/<n>-<topic>` (matches `PROJECT_HISTORY.md`).

Commit messages: short imperative summary. The "why" goes in the body when
non-obvious. Example:

```
Tighten CORS to jamilformula.com origin

Previously '*' meant any site could call the worker on behalf of a
signed-in user. Restricting to the production origin closes that gap.
```

---

## Editing the Worker (`worker.js`)

The Worker is a **single file** because it's deployed by pasting into the
Cloudflare dashboard. Until that changes (see `docs/ARCHITECTURE.md`):

- **Do not** split `worker.js` into multiple files — imports won't resolve
  in the dashboard's paste-deploy mode.
- **Do** group related routes with `/* ── Section ── */` banners.
- **Do** write a Vitest test for any new public route in `tests/worker.test.js`.
- **Do** keep the rate-limit constants in sync with `pricing.html` and
  `PROJECT_HISTORY.md`.

To deploy after a Worker change:

1. Run `npm test && npm run lint`.
2. Copy `worker.js` contents.
3. Cloudflare dashboard → Workers → `formula-ai-brain` → Quick Edit → paste → Save and Deploy.
4. Smoke test: `curl https://formula-ai-brain.jamilaj1.workers.dev/health`.

---

## Editing the HTML pages

There are 22 HTML files, each carrying its own copy of the navbar.
A change to the nav means touching all 22. Until a template system is
introduced, use search-and-replace and verify with:

```bash
grep -l '<old-nav-snippet>' *.html
```

---

## Adding a Supabase migration

1. Add a new SQL file under `database/migrations/` named
   `supabase_phaseN_<topic>.sql`. Append-only (no DROP).
2. Run it in the Supabase SQL Editor against staging first.
3. Document it in a corresponding `docs/deploys/DEPLOY_*.md`.
4. After production, append to `PROJECT_HISTORY.md`.

---

## Adding a Worker route

Template inside `worker.js`:

```js
if (path === '/your_route' && request.method === 'POST') {
  return await handleYourRoute(request, auth, env);
}
```

Then:

1. Add `handleYourRoute(request, auth, env)` near the related section.
2. Track usage with `recordUsage(auth.id, '/your_route', env)` if it's a
   billable action.
3. Add a Vitest test in `tests/worker.test.js`.
4. Update `docs/ARCHITECTURE.md`'s route list.
5. Update the JS client (`assets/supabase-client.js`) to expose it.

---

## Don't commit

- `.env` (real keys) — only `.env.example` is committed.
- Any zip bundle — `*.zip` is gitignored, and `_archive/` is excluded entirely.
- Snapshots of deployed HTML — keep those in `_archive/snapshots/` locally only.
