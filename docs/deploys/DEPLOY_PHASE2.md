# 🚀 Phase 2 Deployment — Auth + Search Limits + Stripe + Safety + Lab

كل الكود جاهز في الـ workspace. هذه الخطوات الستّة لتفعيل كل شيء على المستخدمين الحقيقيين.

---

## ١. شغّل الـ SQL الإضافي في Supabase (٢ دقيقة)

افتح:
```
https://supabase.com/dashboard/project/ivabcssceeaqgqjzgmdx/sql/new
```

الصق محتوى **`supabase_phase2_addon.sql`** كاملًا واضغط **Run**.

ينشئ:
- جدول `api_usage` للحدود اليومية
- عمود `profiles.plan` (افتراضي: `starter`)
- Trigger لإنشاء profile تلقائي عند التسجيل
- RLS policies آمنة

---

## ٢. فعّل Google OAuth في Supabase (٥ دقائق)

### في Supabase:
```
Dashboard → Authentication → Providers → Google
```
1. فعّل Google provider (toggle on)
2. سيطلب منك **Client ID** و **Client Secret**

### في Google Cloud Console:
```
https://console.cloud.google.com/apis/credentials
```
1. **Create Credentials → OAuth Client ID**
2. Application type: **Web application**
3. Authorized redirect URIs:
   ```
   https://ivabcssceeaqgqjzgmdx.supabase.co/auth/v1/callback
   ```
4. انسخ Client ID + Secret إلى Supabase

> **بدون هذه الخطوة، الدخول بـ Google لن يعمل.** لكن الدخول بالإيميل + كلمة سر يعمل بدون أي إعداد.

---

## ٣. حدّث Worker بالكود الجديد (٣ دقائق)

افتح:
```
https://dash.cloudflare.com/?to=/:account/workers-and-pages
```

1. افتح Worker `formula-ai-brain` → **Edit code**
2. **Ctrl+A → Delete** الكود القديم
3. الصق محتوى **`worker.js`** الجديد كاملًا
4. **Save and Deploy**

### أضف متغيّر بيئي جديد:

اذهب إلى **Settings → Variables and Secrets → + Add**:

| الاسم | النوع | القيمة |
|---|---|---|
| `SUPABASE_SERVICE_KEY` | **Secret** | service_role key من Supabase Settings → API |

**هذا المفتاح ضروري** ليتمكن Worker من كتابة سجلات `api_usage`.

---

## ٤. (اختياري) إعداد Stripe (١٥ دقيقة)

> تجاوز هذه الخطوة لو ما تبي تستقبل دفعات الآن. الموقع يعمل بدونها — فقط أزرار Subscribe ترجع خطأ.

### في Stripe Dashboard:
```
https://dashboard.stripe.com/products
```

1. أنشئ ٣ منتجات:
   - **Professional** — $49/month, recurring
   - **Business** — $299/month, recurring
   - **Enterprise** — $999/month, recurring

2. لكل منتج، انسخ **Price ID** (يبدأ بـ `price_...`)

### في Cloudflare Worker → Settings → Variables and Secrets:

| الاسم | النوع | القيمة |
|---|---|---|
| `STRIPE_SECRET_KEY` | **Secret** | `sk_test_...` أو `sk_live_...` |
| `STRIPE_PRICE_PRO` | **Plaintext** | Price ID لـ Professional |
| `STRIPE_PRICE_BIZ` | **Plaintext** | Price ID لـ Business |
| `STRIPE_PRICE_ENT` | **Plaintext** | Price ID لـ Enterprise |
| `STRIPE_WEBHOOK_SECRET` | **Secret** | (اختياري للآن) |

### أضف Webhook في Stripe:
```
https://dashboard.stripe.com/webhooks → Add endpoint
```
- URL: `https://formula-ai-brain.jamilaj1.workers.dev/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## ٥. ارفع الملفات لـ Hostinger (١٠ دقيقة)

في Hostinger File Manager `public_html/`، **استبدل** هذه الملفات (Edit → Ctrl+A → Delete → Paste → Save):

### في `public_html/`:
| الملف | الإجراء |
|---|---|
| `login.html` | استبدل بالكامل (نسخة جديدة فيها Google + email/password) |
| `register.html` | استبدل بالكامل |
| `pricing.html` | استبدل بالكامل (الأزرار تستدعي Stripe الآن) |
| `search.html` | استبدل (يحمّل auth.js) |
| `formulas.html` | استبدل (يحمّل auth.js) |

### في `public_html/assets/`:
| الملف | الإجراء |
|---|---|
| `auth.js` | **جديد** — ارفع |
| `supabase-client.js` | استبدل (v6 يدعم auth + rate limit) |
| `search-live.js` | استبدل (يعرض شريط الاستخدام + رسالة Limit) |
| `formula-detail-live.js` | استبدل (UI احترافي + Hazards + PDF) |

> ⚠️ **مهم:** ضع مفتاح Supabase الـ anon الحقيقي في:
> - `assets/supabase-client.js` (السطر `SUPABASE_ANON = "..."`)
> - `assets/auth.js` (السطر `SUPABASE_ANON = "..."`)

---

## ٦. اختبار شامل (٥ دقائق)

افتح **تبويب خفي** وجرّب بالترتيب:

### 1. ضيف غير مسجّل
- ادخل: `https://jamilformula.com/search.html`
- ابحث ١١ مرة ← في المرة ١١ يجب يظهر **"Daily limit reached — Sign up"**
- شريط الاستخدام أسفل زر البحث يقول: `Guest: 10/10`

### 2. تسجيل حساب جديد
- ادخل: `https://jamilformula.com/register.html`
- أنشئ حساب بإيميل
- يجب يحوّلك تلقائيًا لـ dashboard.html

### 3. مستخدم مسجّل
- ابحث، الشريط يقول: `Free: 1/20` (الحد ٢٠ للمسجّلين)

### 4. تفاصيل فورمولا
- اضغط أي نتيجة بحث → تنقلك لصفحة فيها:
  - ✅ Trust Score كبير
  - ✅ جدول مكونات كامل (CAS أرقام قابلة للنقر تفتح PubChem)
  - ✅ طريقة التحضير
  - ✅ Safety Notes تلقائية (مع Triclosan, Chlorhexidine, إلخ)
  - ✅ زر Export PDF يطبع نسخة نظيفة

### 5. Stripe (لو فعّلت الخطوة ٤)
- اضغط Subscribe على Professional في pricing.html
- يحوّلك لـ Stripe Checkout
- استخدم بطاقة اختبار: `4242 4242 4242 4242` · أي تاريخ مستقبلي · أي CVC
- بعد النجاح يرجع للموقع، plan يصير `professional` تلقائيًا

---

## ٧. تشخيص (لو شيء ما اشتغل)

### الدخول لا يعمل
- F12 → Console → ابحث عن أخطاء حمراء
- الأكثر شيوعًا: مفتاح anon غير موضوع في supabase-client.js أو auth.js

### الحدود اليومية لا تعمل
- تحقق من تشغيل `supabase_phase2_addon.sql`
- تحقق من إضافة `SUPABASE_SERVICE_KEY` في Worker
- في SQL Editor: `select count(*) from api_usage;` يجب يزيد كل بحث

### Stripe Checkout يقول "stripe_not_configured"
- أضف `STRIPE_SECRET_KEY` في Worker variables

### Google Sign-in يقول "redirect_uri_mismatch"
- تحقق من تفعيل Google provider في Supabase وإضافة redirect URI صحيح

---

## ٨. ما تحقق ✅

| الميزة | الحالة |
|---|---|
| 1️⃣ صفحة تفاصيل فورمولا كاملة | ✅ |
| - عرض كل المكونات + CAS + النِسب | ✅ |
| - طريقة التحضير | ✅ |
| - Safety Notes تلقائية | ✅ |
| - زر تصدير PDF | ✅ |
| 2️⃣ Auth بـ Gmail + إيميل | ✅ |
| - 10 بحث/يوم للضيف | ✅ |
| - 20 للمسجّل المجاني | ✅ |
| - 100 للمحترف | ✅ |
| 3️⃣ Stripe Billing | ✅ (يحتاج إعداد منتجات) |
| 4️⃣ Safety Engine + Virtual Lab | ✅ (Worker routes /safety, /lab) |

---

## 🎯 بعد النشر

عندك منصة كاملة:
- 🌐 موقع حي
- 🗄️ 3,381 فورمولا
- 🧠 ذكاء اصطناعي حقيقي
- 🔐 حسابات + حدود
- 💳 دفعات (لما تفعّل Stripe)
- 🛡️ تحليل سلامة بـ AI
- 🧪 محاكاة مختبرية

**جاهز للعرض على المستثمرين والعملاء.** 🎯
