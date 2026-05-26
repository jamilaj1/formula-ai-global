-- ════════════════════════════════════════════════════════════════════
-- EMAIL ON SIGNUP  —  complete, single-paste script.
-- (2026-05-21, updated 2026-05-22: bilingual welcome email)
--
-- On every new signup this queues TWO emails via pg_net + Resend:
--   1. owner notification  -> the owner inbox (always English).
--   2. welcome email       -> the new user, in THEIR chosen language
--                             (Arabic if they picked AR on the site,
--                              English otherwise). The language is read
--                              from raw_user_meta_data ->> 'lang', which
--                              register.html sends from localStorage
--                              key fai_lang. Google-OAuth signups have
--                              no lang in metadata -> default English.
--
-- TO USE:
--   1. Get a Resend API key (resend.com -> API Keys -> Create).
--   2. On the line below, replace re_PASTE_YOUR_KEY_HERE with that key.
--   3. Paste this WHOLE file into Supabase -> SQL Editor -> Run.
--
-- Safe to re-run (every statement is CREATE OR REPLACE / IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Config: the ONLY place you edit. ────────────────────────────────
CREATE OR REPLACE FUNCTION public._owner_email_config()
RETURNS TABLE (resend_api_key TEXT, from_email TEXT, owner_email TEXT)
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    're_PASTE_YOUR_KEY_HERE'::TEXT,      -- <<< your Resend API key
    'signups@jamilformula.com'::TEXT,    -- from: your verified Resend domain
    'jamilaj1@gmail.com'::TEXT;          -- to: your inbox
$$;
REVOKE EXECUTE ON FUNCTION public._owner_email_config() FROM PUBLIC;

-- ── Trigger function: owner notification + bilingual welcome email. ─
-- Fires once per auth.users INSERT and queues two emails via pg_net.
CREATE OR REPLACE FUNCTION public.notify_owner_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  cfg          RECORD;
  meta         JSONB;
  full_name    TEXT;
  safe_name    TEXT;
  edu          TEXT;
  prof         TEXT;
  user_lang    TEXT;
  subject_str  TEXT;
  body_html    TEXT;
  welcome_subj TEXT;
  welcome_html TEXT;
BEGIN
  SELECT * INTO cfg FROM public._owner_email_config();

  -- Not configured yet -> skip silently so signup never breaks.
  IF cfg.resend_api_key IS NULL
     OR cfg.resend_api_key = ''
     OR cfg.resend_api_key LIKE 're_PASTE%' THEN
    RETURN NEW;
  END IF;

  meta := COALESCE(NEW.raw_user_meta_data, '{}'::JSONB);
  full_name := COALESCE(NULLIF(meta ->> 'full_name', ''),
                        split_part(NEW.email, '@', 1));
  safe_name := REPLACE(REPLACE(full_name, '<', '&lt;'), '>', '&gt;');
  edu  := COALESCE(NULLIF(meta ->> 'education_field', ''), '-');
  prof := COALESCE(NULLIF(meta ->> 'profession',      ''), '-');
  user_lang := LOWER(COALESCE(NULLIF(meta ->> 'lang', ''), 'en'));

  -- ── Email 1: owner notification (always English) ─────────────────
  subject_str := 'New signup: ' || full_name
              || CASE WHEN prof <> '-' THEN ' (' || prof || ')' ELSE '' END;

  body_html := format(
       '<div style="font-family:sans-serif; color:#111; line-height:1.6; padding:20px;">'
    || '<h2 style="margin:0 0 10px;">New Formula AI signup</h2>'
    || '<p style="margin:0 0 6px;">Name: <strong>%s</strong></p>'
    || '<p style="margin:0 0 6px;">Email: %s</p>'
    || '<p style="margin:0 0 6px;">Education: %s</p>'
    || '<p style="margin:0 0 6px;">Profession: %s</p>'
    || '<p style="margin:0 0 6px;">Language: %s</p>'
    || '<p style="margin:0 0 16px;">When: %s</p>'
    || '<p><a href="https://jamilformula.com/admin.html" '
    || 'style="background:#0c6; color:#000; padding:10px 18px; '
    || 'text-decoration:none; border-radius:8px; font-weight:700;">'
    || 'Open admin dashboard</a></p></div>',
    safe_name,
    REPLACE(NEW.email, '<', '&lt;'),
    REPLACE(edu,       '<', '&lt;'),
    REPLACE(prof,      '<', '&lt;'),
    user_lang,
    NEW.created_at::TEXT
  );

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',    cfg.from_email,
      'to',      jsonb_build_array(cfg.owner_email),
      'subject', subject_str,
      'html',    body_html
    )
  );

  -- ── Email 2: welcome email — Arabic OR English by user_lang ───────
  IF user_lang = 'ar' THEN
    welcome_subj := 'مرحباً بك في Formula AI Global';
    welcome_html :=
         '<div style="font-family:Arial,Helvetica,sans-serif; max-width:600px; margin:0 auto; background:#ffffff; color:#1a1a1a;">'
      || '<div style="background:#0a0e27; padding:30px 24px; text-align:center;">'
      || '<h1 style="color:#00ff88; margin:0; font-size:23px;">Formula AI Global</h1>'
      || '<p style="color:#94a3b8; margin:6px 0 0; font-size:13px;">منصة الذكاء الكيميائي</p>'
      || '</div>'
      || '<div style="padding:30px 24px;">'
      || '<div dir="rtl" style="text-align:right;">'
      || '<h2 style="font-size:20px; margin:0 0 12px;">مرحباً ' || safe_name || ' 👋</h2>'
      || '<p style="font-size:15px; line-height:1.9; color:#334155; margin:0 0 16px;">'
      || 'أهلاً بك في <strong>Formula AI Global</strong> — أول منصة ذكاء اصطناعي للكيمياء الصناعية. '
      || 'حسابك جاهز الآن: آلاف التركيبات الكيميائية الموثّقة، ومحادثة ذكاء كيميائي تبحث وتقترح وتعدّل، وبحث ذكي فوري.'
      || '</p>'
      || '<p style="font-size:15px; font-weight:700; margin:18px 0 8px;">ابدأ من هنا:</p>'
      || '<p style="margin:7px 0; font-size:14px;">🔍 <a href="https://jamilformula.com/search.html" style="color:#0066cc; text-decoration:none;">البحث الذكي</a> — ابحث في آلاف التركيبات</p>'
      || '<p style="margin:7px 0; font-size:14px;">💬 <a href="https://jamilformula.com/chat.html" style="color:#0066cc; text-decoration:none;">المحادثة الذكية</a> — اسأل خبير الكيمياء</p>'
      || '<p style="margin:7px 0; font-size:14px;">🏭 <a href="https://jamilformula.com/industries.html" style="color:#0066cc; text-decoration:none;">تصفّح حسب الصناعة</a> — 40 قطاعاً صناعياً</p>'
      || '</div>'
      || '<div dir="rtl" style="text-align:right; margin:22px 0;">'
      || '<a href="https://jamilformula.com/dashboard.html" style="display:inline-block; background:#00cc6a; color:#000000; padding:13px 28px; text-decoration:none; border-radius:8px; font-weight:700; font-size:15px;">افتح لوحة التحكم</a>'
      || '</div>'
      || '<div dir="rtl" style="text-align:right; background:#f0fdf4; border-radius:10px; padding:14px 16px; margin:16px 0;">'
      || '<p style="margin:0; font-size:13px; color:#15803d; line-height:1.8;">شارك تركيباتك الخاصة واكسب اشتراك Pro مجاناً — كل 5 تركيبات موثّقة = شهر Pro مجاني.</p>'
      || '</div>'
      || '<div dir="rtl" style="text-align:right; margin-top:20px;">'
      || '<p style="font-size:14px; color:#334155; margin:0; line-height:1.8;">بالتوفيق،<br><strong>جميل عبد الجليل</strong><br><span style="color:#64748b; font-size:12px;">مؤسّس Formula AI Global — كيميائي صناعي بخبرة 25+ سنة</span></p>'
      || '</div>'
      || '</div>'
      || '<div style="background:#f8fafc; padding:18px 24px; text-align:center; border-top:1px solid #e2e8f0;">'
      || '<p style="font-size:11px; color:#94a3b8; margin:0;">jamilformula.com &middot; &copy; 2026 Formula AI Global</p>'
      || '</div>'
      || '</div>';
  ELSE
    welcome_subj := 'Welcome to Formula AI Global';
    welcome_html :=
         '<div style="font-family:Arial,Helvetica,sans-serif; max-width:600px; margin:0 auto; background:#ffffff; color:#1a1a1a;">'
      || '<div style="background:#0a0e27; padding:30px 24px; text-align:center;">'
      || '<h1 style="color:#00ff88; margin:0; font-size:23px;">Formula AI Global</h1>'
      || '<p style="color:#94a3b8; margin:6px 0 0; font-size:13px;">Chemistry Intelligence Platform</p>'
      || '</div>'
      || '<div style="padding:30px 24px;">'
      || '<div dir="ltr" style="text-align:left;">'
      || '<h2 style="font-size:20px; margin:0 0 12px;">Hi ' || safe_name || ' 👋</h2>'
      || '<p style="font-size:15px; line-height:1.7; color:#334155; margin:0 0 16px;">'
      || 'Welcome to <strong>Formula AI Global</strong> — the first AI platform for industrial chemistry. '
      || 'Your account is ready: thousands of verified chemical formulas, a chemistry AI that searches, suggests and modifies, plus instant smart search.'
      || '</p>'
      || '<p style="font-size:15px; font-weight:700; margin:18px 0 8px;">Start here:</p>'
      || '<p style="margin:7px 0; font-size:14px;">🔍 <a href="https://jamilformula.com/search.html" style="color:#0066cc; text-decoration:none;">Smart Search</a> — search thousands of formulas</p>'
      || '<p style="margin:7px 0; font-size:14px;">💬 <a href="https://jamilformula.com/chat.html" style="color:#0066cc; text-decoration:none;">AI Chat</a> — ask the chemistry expert</p>'
      || '<p style="margin:7px 0; font-size:14px;">🏭 <a href="https://jamilformula.com/industries.html" style="color:#0066cc; text-decoration:none;">Browse by industry</a> — 40 industrial sectors</p>'
      || '</div>'
      || '<div dir="ltr" style="text-align:left; margin:22px 0;">'
      || '<a href="https://jamilformula.com/dashboard.html" style="display:inline-block; background:#00cc6a; color:#000000; padding:13px 28px; text-decoration:none; border-radius:8px; font-weight:700; font-size:15px;">Open dashboard</a>'
      || '</div>'
      || '<div dir="ltr" style="text-align:left; background:#f0fdf4; border-radius:10px; padding:14px 16px; margin:16px 0;">'
      || '<p style="margin:0; font-size:13px; color:#15803d; line-height:1.8;">Share your own formulas and earn free Pro — every 5 verified formulas = 1 free Pro month.</p>'
      || '</div>'
      || '<div dir="ltr" style="text-align:left; margin-top:20px;">'
      || '<p style="font-size:14px; color:#334155; margin:0; line-height:1.8;">Best regards,<br><strong>Jamil Abduljalil</strong><br><span style="color:#64748b; font-size:12px;">Founder, Formula AI Global — industrial chemist, 25+ years experience</span></p>'
      || '</div>'
      || '</div>'
      || '<div style="background:#f8fafc; padding:18px 24px; text-align:center; border-top:1px solid #e2e8f0;">'
      || '<p style="font-size:11px; color:#94a3b8; margin:0;">jamilformula.com &middot; &copy; 2026 Formula AI Global</p>'
      || '</div>'
      || '</div>';
  END IF;

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cfg.resend_api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',     'Formula AI Global <' || cfg.from_email || '>',
      'to',       jsonb_build_array(NEW.email),
      'reply_to', cfg.owner_email,
      'subject',  welcome_subj,
      'html',     welcome_html
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A mail failure must never block a real signup.
  RAISE WARNING 'notify_owner_on_signup failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── Attach the trigger to auth.users INSERT. ────────────────────────
DROP TRIGGER IF EXISTS notify_owner_on_signup_trigger ON auth.users;
CREATE TRIGGER notify_owner_on_signup_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_owner_on_signup();

-- ════════════════════════════════════════════════════════════════════
-- TO DISABLE:  DROP TRIGGER notify_owner_on_signup_trigger ON auth.users;
-- TO ROLLBACK:
--   DROP TRIGGER   IF EXISTS notify_owner_on_signup_trigger ON auth.users;
--   DROP FUNCTION  IF EXISTS public.notify_owner_on_signup();
--   DROP FUNCTION  IF EXISTS public._owner_email_config();
-- ════════════════════════════════════════════════════════════════════
