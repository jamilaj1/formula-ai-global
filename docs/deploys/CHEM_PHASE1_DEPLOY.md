# Phase 1 — Real Chemistry Engine deployment

This guide walks you through deploying the Python FastAPI backend that
powers `/api/chem/*` endpoints. After this you'll have a working RDKit
integration — the foundation of real chemistry AI.

**Outcome after this guide:** `https://jamilformula.com` can compute
real molecular properties (mw, logP, TPSA, Lipinski rule of 5, etc.)
instead of asking Claude to guess them.

---

## Architecture (where Phase 1 fits)

```
Browser ──HTTPS──▶ Cloudflare Worker (worker.js, edge)
                         │
                         ├─ /search, /chat, /paystack/* …  (LLM + Supabase, unchanged)
                         │
                         └─ /chem/*  ──HTTPS──▶ Python FastAPI (new)
                                                   │
                                                   ├─ RDKit  (compute_properties)
                                                   ├─ NumPy/SciPy (descriptors)
                                                   └─ services/chemistry.py
```

The Worker is unchanged in spirit — it just adds a proxy step. The new
Python backend is the only place where actual chemistry happens.

---

## Prerequisites

- A GitHub account (free)
- A Render account (https://render.com — free signup, then $7/mo plan)
  - OR Fly.io (https://fly.io — has a free allowance)
- The repo pushed to GitHub (private)

If you don't have GitHub set up yet, see the "Git + GitHub one-time
setup" section at the bottom.

---

## Step 1 — Install dependencies locally (optional sanity check)

You can skip this and deploy directly. But running locally first catches
issues fast.

```bash
cd backend
python -m venv venv
# Windows PowerShell:
venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
```

RDKit is the heaviest dep (~200 MB wheel). Install takes 30–90 seconds
on a fast connection.

### Smoke test

```bash
pytest tests/test_chemistry.py -v
```

You should see ~20 tests pass. If they pass, RDKit is working on your
machine.

### Run the API locally

```bash
uvicorn main:app --reload --port 8080
```

Then in another terminal:

```bash
curl http://localhost:8080/api/chem/health
# {"status":"ok","rdkit_working":true,"test_compound":"ethanol","molecular_weight":46.069,"formula":"C2H6O"}

curl -X POST http://localhost:8080/api/chem/properties \
  -H "Content-Type: application/json" \
  -d '{"smiles":"CC(=O)Oc1ccccc1C(=O)O"}'
# Returns aspirin properties (mw=180.16, formula=C9H8O4, ...)
```

If this works locally, deployment is straightforward.

---

## Step 2 — Deploy to Render

### 2a. Push the repo to GitHub

If you haven't already:

```bash
cd H:\FormulaAI-Backup-2026-05-11
git init
git branch -m main
git add .
git commit -m "Initial commit"

# Create a private repo at https://github.com/new
# Then:
git remote add origin https://github.com/<your-username>/formula-ai-global.git
git push -u origin main
```

### 2b. Connect Render to GitHub

1. Sign in to https://render.com
2. **New** → **Blueprint**
3. Connect your GitHub account, authorise Render to read the repo
4. Select the `formula-ai-global` repo
5. Render reads `backend/render.yaml` and offers to create the service

### 2c. Set the secrets

When Render prompts for env vars, paste these from your existing
Cloudflare Worker secrets:

| Env var | Source |
| --- | --- |
| `SUPABASE_URL` | Public — `https://ivabcssceeaqgqjzgmdx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Same as Worker (Supabase → Settings → API → service_role) |
| `SUPABASE_ANON_KEY` | Same as Worker |
| `ANTHROPIC_API_KEY` | Same as Worker |

Click **Apply**. Render builds the Docker image (~3-5 min first time)
and gives you a URL like `https://formula-ai-chem.onrender.com`.

### 2d. Verify the deployment

```bash
curl https://formula-ai-chem.onrender.com/health
# {"status":"ok","version":"3.0.0"}

curl https://formula-ai-chem.onrender.com/api/chem/health
# {"status":"ok","rdkit_working":true,"molecular_weight":46.069,...}
```

If `/api/chem/health` returns 200 with `rdkit_working: true`, **RDKit is
live in production**. 🎯

---

## Step 3 — Connect the Worker

Tell the Cloudflare Worker where the Python backend lives.

### 3a. Add the env var to Cloudflare

1. Cloudflare → Workers → `formula-ai-brain` → **Settings** → **Variables and Secrets**
2. Click **+ Add variable**
3. Type: **Text** (not secret — the URL is public)
4. Name: `CHEM_BACKEND_URL`
5. Value: `https://formula-ai-chem.onrender.com` (the URL Render gave you)
6. Save

### 3b. Build + deploy the updated Worker

The new `worker-src/` has the proxy code. Build and deploy:

```bash
cd H:\FormulaAI-Backup-2026-05-11
npm run build:worker          # bundle worker-src/ → worker.js
```

Then either:
- **Wrangler**: `npm run deploy:worker`
- **Paste**: open `worker.js` in Notepad, Ctrl+A, Ctrl+C → Cloudflare → Quick Edit → Save and Deploy

### 3c. End-to-end test

```bash
# Test via the Worker (which forwards to Render)
curl https://formula-ai-brain.jamilaj1.workers.dev/chem/health
# {"status":"ok","rdkit_working":true,...}

curl -X POST https://formula-ai-brain.jamilaj1.workers.dev/chem/properties \
  -H "Content-Type: application/json" \
  -d '{"smiles":"CCO"}'
# {"valid":true,"smiles_canonical":"CCO","molecular_weight":46.069,...}
```

If both work, **the chemistry engine is live**.

---

## Step 4 — Use it from the frontend

In `assets/supabase-client.js`, add a chem helper:

```js
async computeProperties(smiles) {
  try {
    const r = await fetch(`${WORKER_URL}/chem/properties`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ smiles }),
    });
    return await r.json();
  } catch (err) {
    return { error: err.message };
  }
},
```

Then in any page:

```html
<script type="module">
  import './assets/supabase-client.js';
  const result = await FAI_DB.computeProperties('CC(=O)Oc1ccccc1C(=O)O');
  console.log(result.molecular_weight);  // 180.158
  console.log(result.formula);           // C9H8O4
</script>
```

---

## Cost

| Service | Cost |
| --- | --- |
| Render Starter | $7/mo |
| Cloudflare Worker | $0 (still free tier) |
| Supabase | unchanged ($25/mo) |
| **New monthly cost** | **+$7/mo** |

Render's free tier exists but sleeps after 15 min of inactivity (cold
start ~30s). For production with real users, the $7/mo Starter plan is
worth it.

---

## Troubleshooting

### "rdkit_not_installed" error
RDKit failed to install in the container. Check Render's build logs.
The Dockerfile installs the system deps libxrender1/libxext6 needed by
RDKit. If the wheel can't compile, switch to the conda image:

```dockerfile
FROM continuumio/miniconda3:latest
RUN conda install -c conda-forge rdkit numpy scipy -y
```

### `chem_backend_unreachable` (502)
The Worker can't reach Render. Common causes:
1. `CHEM_BACKEND_URL` typo in Cloudflare vars
2. Render service stopped (check Render dashboard → service status)
3. Render Starter plan has scaled to 0 — upgrade or pre-warm with cron

### `chem_backend_timeout` (504)
The Render service is taking >30 s. Either:
1. First request after sleep — wait and retry
2. Heavy batch input — split into smaller batches
3. Bump TIMEOUT_MS in `worker-src/handlers/chem.js`

### Tests fail locally with "ModuleNotFoundError: rdkit"
You're missing the system dep that RDKit needs. On Ubuntu:
```bash
sudo apt-get install -y libxrender1 libxext6 libglib2.0-0
```
On Windows, the pip wheel includes its own DLLs — `pip install rdkit`
should just work.

---

## Next phases (after this is stable)

| Phase | What | Effort |
| --- | --- | --- |
| 1.5 | Backfill SMILES for the existing 3,381 formulas | 1 week |
| 2 | Add PubChem similarity search (FAISS) | 4 weeks |
| 3 | Multi-agent reasoning (6 specialised agents) | 6 weeks |
| 4 | Property-prediction ML models | 8 weeks |
| 5 | Continuous learning from new papers | ongoing |
| 6 | Vision (label → ingredients via image) | 4 weeks |

Each phase is its own deploy + migration. Don't start phase 2 until
phase 1 has been hit by real users for a week.

---

## Appendix — Git + GitHub one-time setup

If you've never used git:

```bash
# Install git from https://git-scm.com/download/win (Windows)

# Set your identity (once per machine)
git config --global user.name "Jamil Abduljalil"
git config --global user.email "jamilaj1@gmail.com"

# Inside the project folder
cd H:\FormulaAI-Backup-2026-05-11
git init
git branch -m main

# Important: verify .gitignore protects secrets
cat .gitignore | grep -E "\.env|node_modules"

# First commit
git add .
git commit -m "Initial commit: Phase 1 ready"

# Create the repo at github.com/new (PRIVATE!), then:
git remote add origin https://github.com/<your-username>/formula-ai-global.git
git push -u origin main
```

The `.gitignore` we already wrote keeps secrets out of git. **Verify**
before pushing that no `.env` or key file is staged:

```bash
git status        # should not show .env, only source files
```
