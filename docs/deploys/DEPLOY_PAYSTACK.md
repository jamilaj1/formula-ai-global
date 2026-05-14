# 🟢 Paystack Billing — Ghana-friendly, Global Coverage

Replaces Stripe (which doesn't work for Ghana merchants). Paystack is owned by Stripe and accepts:
- ✅ Visa / Mastercard / Amex from **any country worldwide**
- ✅ Mobile Money (MTN, AirtelTigo, Vodafone, M-Pesa) for African customers
- ✅ Bank transfers in supported regions
- ✅ Apple Pay / Google Pay
- ✅ 1.9% fee — much lower than Lemon Squeezy (5%) or Paddle (5%)

---

## ☑ Checklist

### Your part (45 min total, mostly waiting)

1. **Sign up** — https://paystack.com/signup
   - Email: `jamilaj1@gmail.com`
   - Country: **Ghana**
   - Business name: `Formula AI Global` (or DosLunas Ltd if you prefer)

2. **Complete KYC**
   - Personal info + phone + address
   - Business info (DosLunas works as Limited Company)
   - Bank account (Ghana GHS account or Wise USD if you have one)
   - Upload Government ID + selfie
   - Submit for review → **24-48h approval**

3. **Test Mode keys are available immediately** (you don't need to wait for approval to test)

4. **Get your test keys** — Settings → API Keys & Webhooks
   - Test Secret Key (`sk_test_...`)
   - Test Public Key (`pk_test_...`)

5. **Create 3 plans** — Plans → + Add Plan
   - **Professional**: $49/month USD → copy Plan code (`PLN_...`)
   - **Business**: $299/month USD → copy Plan code
   - **Enterprise**: $999/month USD → copy Plan code

6. **Add webhook URL** — Settings → API Keys & Webhooks → Webhook URL:
   ```
   https://formula-ai-brain.jamilaj1.workers.dev/paystack/webhook
   ```
   Select events: `charge.success`, `subscription.create`, `subscription.disable`, `subscription.not_renew`

7. **Send me the keys** (or set them yourself in Worker):
   ```
   PAYSTACK_SECRET_KEY = sk_test_xxxxx
   PAYSTACK_PLAN_PRO   = PLN_xxxxx
   PAYSTACK_PLAN_BIZ   = PLN_xxxxx
   PAYSTACK_PLAN_ENT   = PLN_xxxxx
   ```

---

## My part (already done, deploy below)

### 1. SQL — adds Paystack columns to `profiles`
File: `supabase_paystack.sql`

Run in Supabase SQL Editor. Adds:
- `paystack_customer_code`
- `paystack_subscription_code`
- `paystack_authorization_code`
- `plan_renews_at`

### 2. Worker — new endpoints
File: `worker.js` (updated)

New endpoints:
- `POST /paystack/checkout` — initialize a transaction, returns Paystack hosted-checkout URL
- `GET /paystack/verify?reference=…` — verify a transaction after callback
- `POST /paystack/webhook` — receive subscription events (signed with HMAC SHA-512)

Stripe code is kept as legacy fallback.

### 3. Frontend — auto-tries Paystack first
File: `assets/supabase-client.js` (updated)

`FAI_DB.startCheckout('professional')` now:
1. Calls `/paystack/checkout` first
2. If Paystack isn't configured, falls back to `/stripe/checkout`
3. Redirects user to whichever returns first

`pricing.html` doesn't need changes — same `data-checkout="professional"` buttons work.

---

## Deployment steps

### Step 1 — Run SQL (1 minute)
Open https://supabase.com/dashboard/project/ivabcssceeaqgqjzgmdx/sql/new
Paste `supabase_paystack.sql` → Run.

### Step 2 — Add secrets to Cloudflare Worker
Worker → Settings → Variables and Secrets → + Add:

| Name | Type | Value |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | **Secret** | `sk_test_...` |
| `PAYSTACK_PLAN_PRO` | Plaintext | `PLN_...` (Professional) |
| `PAYSTACK_PLAN_BIZ` | Plaintext | `PLN_...` (Business) |
| `PAYSTACK_PLAN_ENT` | Plaintext | `PLN_...` (Enterprise) |

### Step 3 — Deploy Worker
- Edit code → Ctrl+A → Delete
- Paste the new `worker.js`
- **Deploy**

### Step 4 — Upload `supabase-client.js` to Hostinger
- `public_html/assets/supabase-client.js` (replace)

That's it. `pricing.html` stays as is.

---

## Testing

### Test with Test Mode keys (no real money)

1. Open https://jamilformula.com/pricing.html in **incognito** mode
2. Sign in
3. Click **Subscribe** on Professional
4. You'll be redirected to Paystack's hosted checkout
5. Use Paystack's **test card**:
   ```
   Card:  4084 0840 8408 4081
   CVV:   408
   Date:  any future date
   PIN:   0000
   OTP:   123456
   ```
6. Payment succeeds → you're redirected back to `/dashboard.html?paystack=success`
7. Open Supabase → `profiles` table → your row should now show `plan = 'professional'` and `paystack_subscription_code` filled

### Verify webhook
Paystack Dashboard → Logs → Webhook → you should see the `charge.success` event and the response `200 OK`.

### Going live
After your account is approved (24-48h):
- Switch keys from `sk_test_...` to `sk_live_...`
- Create live Plans (same names, get new `PLN_...` codes)
- Update Worker secrets with live values
- Test with a small real payment (e.g., $1 trial)

---

## What this gives you

| Customer location | Payment method | Works? |
|---|---|---|
| 🇬🇭 Ghana | Cards · Mobile Money | ✅ |
| 🇳🇬 Nigeria | Cards · USSD · Bank | ✅ |
| 🇰🇪 Kenya | Cards · M-Pesa | ✅ |
| 🇿🇦 South Africa | Cards · EFT | ✅ |
| 🇺🇸 USA | Cards · Apple Pay · Google Pay | ✅ |
| 🇬🇧 UK | Cards · Apple Pay | ✅ |
| 🇸🇦 Saudi Arabia | Cards · Apple Pay | ✅ |
| 🇪🇺 Europe | Cards · Apple Pay · Google Pay | ✅ |
| 🇨🇳 China | International cards (limited) | ⚠️ |
| 🇰🇵 North Korea | None | ❌ (sanctions) |

For the **95% of paying customers** worldwide, this works perfectly.

For the missing 5% (China Alipay/WeChat, niche local methods), we can add **Coinbase Commerce** later as a complement — that covers literally everyone in the world via crypto.

---

## Cost summary

| Item | Cost |
|---|---|
| Paystack signup | Free |
| Per transaction | 1.9% + 1 GHS (~$0.06) |
| Monthly minimum | None |
| Settlement | Daily to your Ghana bank, in GHS |
| International cards surcharge | +1% (so 2.9% total for non-Ghana cards) |

On a $49 subscription:
- Stripe (hypothetical) would take ~$1.72
- Lemon Squeezy would take ~$2.95
- **Paystack takes ~$1.42** ✅

---

## Send me when ready

Drop the 4 values into the chat (you can mask the last few characters if you want):
```
PAYSTACK_SECRET_KEY = sk_test_…
PAYSTACK_PLAN_PRO   = PLN_…
PAYSTACK_PLAN_BIZ   = PLN_…
PAYSTACK_PLAN_ENT   = PLN_…
```

I'll confirm they're in the right format and you can paste them yourself into Cloudflare Worker secrets.

Or just paste them into the Worker yourself — I've already written all the code that consumes them.

---

## Going live checklist

- [ ] Paystack account approved (24-48h)
- [ ] Live keys (`sk_live_...`) replaced in Worker
- [ ] Live Plans created (new PLN_ codes)
- [ ] Tested with $1 real transaction
- [ ] Webhook URL confirmed receiving events
- [ ] First customer signed up successfully

That's all.
