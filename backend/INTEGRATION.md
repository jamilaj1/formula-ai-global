# Wiring auth + billing into main.py

The new `auth.py` and `billing.py` modules are designed to plug into your
existing `main.py` without circular imports. Here's how.

## 1. Add to requirements.txt

```txt
fastapi>=0.115
uvicorn[standard]>=0.32
python-jose[cryptography]>=3.3
passlib[bcrypt]>=1.7.4
pydantic[email]>=2.9
stripe>=11.0
supabase>=2.7
anthropic>=0.40
python-dotenv>=1.0
redis>=5.2
httpx>=0.27
```

## 2. main.py — minimal setup

```python
import os
from fastapi import FastAPI
from supabase import create_client
import anthropic
from dotenv import load_dotenv

from auth import register_auth_routes
from billing import register_billing_routes

load_dotenv()

app = FastAPI(title="Formula AI Global API", version="3.0.0")

# Clients
supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY"),
)
claude = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Wire auth — returns the dependencies for guarded routes
auth_deps = register_auth_routes(app, supabase)
get_current_active_user = auth_deps["get_current_active_user"]

# Wire billing — uses the auth dependency
register_billing_routes(app, supabase, get_current_active_user)


# Public route — no auth
@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}


# Guarded route example
from fastapi import Depends
from auth import UserInDB

@app.get("/protected")
async def protected(user: UserInDB = Depends(get_current_active_user)):
    return {"hello": user.email}
```

## 3. Tier-guarded route

```python
from auth import require_tier

require_pro = require_tier("professional")(get_current_active_user)

@app.get("/pro-feature")
async def pro_feature(user: UserInDB = Depends(require_pro)):
    return {"message": "You're a pro user!"}
```

## 4. Database schema additions

The `users` table needs these columns (add if missing):

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'starter';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_calls_today INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS formulas_used_this_month INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_invoice_id VARCHAR(100) UNIQUE,
    customer_id VARCHAR(100),
    amount NUMERIC,
    currency VARCHAR(10),
    status VARCHAR(50),
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## 5. Frontend integration (existing static site)

The existing `login.html` form can post to `/auth/login`:

```html
<form id="login-form">
  <input name="email" type="email" required />
  <input name="password" type="password" required />
  <button type="submit">Sign in</button>
</form>

<script>
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = e.target.email.value;
  const password = e.target.password.value;

  const res = await fetch('https://api.jamilformula.com/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.setItem('token', data.access_token);
    window.location.href = './dashboard.html';
  } else {
    alert(data.detail || 'Login failed');
  }
});
</script>
```

## 6. Run locally

```bash
cd backend
cp .env.example .env
# Fill in real values
docker compose up --build
```

API at <http://localhost:8000>, docs at <http://localhost:8000/docs>.

To also run the optional Streamlit UI:

```bash
docker compose --profile streamlit up
```

## 7. Production deployment

```bash
# Build and tag
docker build -t formula-ai/api:1.0.0 -f Dockerfile .

# Push to registry
docker tag formula-ai/api:1.0.0 yourregistry.io/formula-ai/api:1.0.0
docker push yourregistry.io/formula-ai/api:1.0.0

# Deploy via your favorite orchestrator (k8s, ECS, Railway, Render…)
```

## Resolved conflicts

| Conflict | Resolution |
|---|---|
| Auth used Supabase Auth in frontend | New JWT auth replaces it — frontend posts to `/auth/login` |
| Pricing tiers (3 vs 4) | Standardized on **starter / professional / business / enterprise** to match `pricing.html` |
| Circular import (`stripe_billing → main`) | Refactored with `register_billing_routes(app, supabase, get_user)` factory |
| Streamlit UI duplicates static site | Streamlit kept as **optional** profile in docker-compose; static HTML remains canonical |
| Flutter mobile | Skipped — out of scope for this iteration; recommend separate repo |

## Bug fixes applied

- ✅ Imports of `BaseModel`, `Optional`, `Dict` added
- ✅ `UserInDB` extended with `stripe_customer_id`, `stripe_subscription_id`, etc.
- ✅ Naive `datetime.utcnow()` replaced with timezone-aware `datetime.now(timezone.utc)`
- ✅ `stripe.error.SignatureVerificationError` replaced with generic `Exception` for compatibility with stripe>=11
- ✅ `bcrypt rounds` set explicitly to 12 for predictable hash cost
- ✅ Health check uses `curl` (more reliable than `urllib`)
- ✅ Non-root container user (`uid 1000`) for security
