-- =============================================================================
-- Formula AI Global - Complete Database Schema
-- =============================================================================
-- Run in Supabase Studio -> SQL Editor.
-- Idempotent: every CREATE uses IF NOT EXISTS, every policy is dropped first.
-- Safe to re-run after a partial earlier run (e.g. when 'payments' already exists).
-- =============================================================================

-- Required extensions ---------------------------------------------------------
create extension if not exists "pgcrypto";  -- for gen_random_uuid()


-- =============================================================================
-- 1. CORE: profiles
-- =============================================================================
create table if not exists public.profiles (
  id                          uuid primary key references auth.users(id) on delete cascade,
  email                       text,
  full_name                   text,
  avatar_url                  text,
  plan                        text not null default 'starter',
  formulas_used_this_month    int  not null default 0,
  monthly_quota_resets_at     timestamptz not null default (now() + interval '1 month'),
  stripe_customer_id          text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id);
create index if not exists profiles_email_idx on public.profiles (email);


-- =============================================================================
-- 2. CONTENT: search_history, saved_formulas, uploaded_books
-- =============================================================================
create table if not exists public.search_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  query       text not null,
  language    text not null default 'en',
  result      text,
  tokens_in   int,
  tokens_out  int,
  created_at  timestamptz not null default now()
);
create index if not exists search_history_user_created_idx
  on public.search_history (user_id, created_at desc);


create table if not exists public.saved_formulas (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  category          text,
  components        jsonb,
  notes             text,
  source_search_id  uuid references public.search_history(id) on delete set null,
  trust_score       int default 100,
  is_public         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists saved_formulas_user_idx on public.saved_formulas (user_id);
create index if not exists saved_formulas_category_idx on public.saved_formulas (category);


create table if not exists public.uploaded_books (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  filename            text not null,
  size_bytes          bigint not null,
  pages               int,
  formulas_extracted  int not null default 0,
  status              text not null default 'completed',  -- pending|completed|failed
  created_at          timestamptz not null default now()
);
create index if not exists uploaded_books_user_idx on public.uploaded_books (user_id);


-- =============================================================================
-- 3. BILLING: subscription_plans, subscriptions, payments
-- =============================================================================
create table if not exists public.subscription_plans (
  id                  uuid primary key default gen_random_uuid(),
  slug                text unique not null,           -- 'starter' | 'professional' | 'business' | 'enterprise'
  name                text not null,
  price_monthly       decimal(10,2) not null default 0,
  price_yearly        decimal(10,2),
  currency            varchar(3) not null default 'USD',
  formula_quota       int not null default 10,        -- formulas/month, -1 = unlimited
  upload_quota_mb     int not null default 0,         -- pdf upload allowance, -1 = unlimited
  features            jsonb,
  stripe_price_id     text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Seed the four canonical plans (idempotent)
insert into public.subscription_plans (slug, name, price_monthly, formula_quota, features)
values
  ('starter',      'Starter',      0,    10,   '["Basic search","PDF export","10 formulas/month"]'::jsonb),
  ('professional', 'Professional', 49,   100,  '["Advanced AI","API access","100 formulas/month"]'::jsonb),
  ('business',     'Business',     299,  -1,   '["Unlimited formulas","Team access","24/7 support"]'::jsonb),
  ('enterprise',   'Enterprise',   999,  -1,   '["Everything","On-premise","Custom development"]'::jsonb)
on conflict (slug) do nothing;


create table if not exists public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  plan_id                  uuid not null references public.subscription_plans(id),
  status                   text not null default 'active',  -- active|past_due|cancelled|expired
  stripe_subscription_id   text unique,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_stripe_idx on public.subscriptions (stripe_subscription_id);


create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  plan_id                  uuid references public.subscription_plans(id),
  amount                   decimal(10,2) not null,
  currency                 varchar(3) not null default 'USD',
  status                   text not null,  -- succeeded|failed|refunded|pending
  payment_method           varchar(50),
  stripe_payment_intent_id varchar(100) unique,
  stripe_invoice_id        varchar(100),
  stripe_receipt_url       text,
  created_at               timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id);
create index if not exists payments_status_idx on public.payments (status);


-- =============================================================================
-- 4. METADATA: industries, standards, chemical_compounds (reference data)
-- =============================================================================
create table if not exists public.industries (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  description  text,
  icon         text,
  created_at   timestamptz not null default now()
);

insert into public.industries (slug, name, description) values
  ('cosmetics',    'Cosmetics',          'Personal care, skin care, hair care'),
  ('cleaning',     'Cleaning Products',  'Detergents, disinfectants, surface cleaners'),
  ('automotive',   'Automotive',         'Car shampoos, polishes, coolants'),
  ('industrial',   'Industrial',         'Lubricants, coatings, solvents'),
  ('food',         'Food & Beverage',    'Food-grade additives and processing aids'),
  ('agriculture',  'Agriculture',        'Fertilizers, pesticides, plant nutrients'),
  ('pharmaceutical','Pharmaceutical',    'Excipients and topical formulations'),
  ('textile',      'Textile',            'Fabric softeners, dyes, finishing agents')
on conflict (slug) do nothing;


create table if not exists public.standards (
  id           uuid primary key default gen_random_uuid(),
  code         text unique not null,
  name         text not null,
  region       text,        -- 'EU' | 'US' | 'GCC' | 'global'
  description  text,
  url          text,
  created_at   timestamptz not null default now()
);

insert into public.standards (code, name, region, description) values
  ('EU-1223',    'EU Cosmetic Regulation 1223/2009', 'EU',     'Cosmetic products in the European Union'),
  ('FDA-CFR-21', 'FDA 21 CFR',                       'US',     'US Food, Drug & Cosmetic regulations'),
  ('REACH',      'REACH',                            'EU',     'EU chemical registration framework'),
  ('GHS',        'Globally Harmonized System',       'global', 'Hazard classification and labeling'),
  ('ISO-22716',  'ISO 22716',                        'global', 'GMP for cosmetics'),
  ('GSO-1943',   'GSO 1943',                         'GCC',    'Gulf cosmetic safety standard')
on conflict (code) do nothing;


create table if not exists public.chemical_compounds (
  id              uuid primary key default gen_random_uuid(),
  cas_number      text unique,
  name            text not null,
  iupac_name      text,
  formula         text,
  molecular_weight decimal(10,4),
  typical_function text,           -- 'surfactant' | 'preservative' | 'pH-adjuster' | ...
  hazard_class    text,
  pubchem_cid     int,
  created_at      timestamptz not null default now()
);
create index if not exists compounds_cas_idx on public.chemical_compounds (cas_number);
create index if not exists compounds_name_idx on public.chemical_compounds (name);


-- =============================================================================
-- 5. USAGE TRACKING: api_usage (for rate limiting / billing)
-- =============================================================================
create table if not exists public.api_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  endpoint    text not null,        -- '/api/brain' | '/api/upload' | ...
  status_code int,
  duration_ms int,
  tokens_in   int,
  tokens_out  int,
  created_at  timestamptz not null default now()
);
create index if not exists api_usage_user_created_idx on public.api_usage (user_id, created_at desc);
create index if not exists api_usage_endpoint_idx on public.api_usage (endpoint);


-- =============================================================================
-- 6. ROW-LEVEL SECURITY
-- =============================================================================
alter table public.profiles            enable row level security;
alter table public.search_history      enable row level security;
alter table public.saved_formulas      enable row level security;
alter table public.uploaded_books      enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.payments            enable row level security;
alter table public.api_usage           enable row level security;
-- Reference tables stay readable by everyone:
alter table public.subscription_plans  enable row level security;
alter table public.industries          enable row level security;
alter table public.standards           enable row level security;
alter table public.chemical_compounds  enable row level security;

-- profiles: own rows only
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);

-- search_history
drop policy if exists "history_select_own" on public.search_history;
drop policy if exists "history_insert_own" on public.search_history;
drop policy if exists "history_delete_own" on public.search_history;
create policy "history_select_own" on public.search_history for select using (auth.uid() = user_id);
create policy "history_insert_own" on public.search_history for insert with check (auth.uid() = user_id);
create policy "history_delete_own" on public.search_history for delete using (auth.uid() = user_id);

-- saved_formulas (also lets authenticated users read public ones)
drop policy if exists "saved_select_own" on public.saved_formulas;
drop policy if exists "saved_insert_own" on public.saved_formulas;
drop policy if exists "saved_update_own" on public.saved_formulas;
drop policy if exists "saved_delete_own" on public.saved_formulas;
drop policy if exists "saved_select_public" on public.saved_formulas;
create policy "saved_select_own" on public.saved_formulas for select using (auth.uid() = user_id);
create policy "saved_select_public" on public.saved_formulas for select using (is_public = true);
create policy "saved_insert_own" on public.saved_formulas for insert with check (auth.uid() = user_id);
create policy "saved_update_own" on public.saved_formulas for update using (auth.uid() = user_id);
create policy "saved_delete_own" on public.saved_formulas for delete using (auth.uid() = user_id);

-- uploaded_books
drop policy if exists "books_select_own" on public.uploaded_books;
drop policy if exists "books_insert_own" on public.uploaded_books;
drop policy if exists "books_delete_own" on public.uploaded_books;
create policy "books_select_own" on public.uploaded_books for select using (auth.uid() = user_id);
create policy "books_insert_own" on public.uploaded_books for insert with check (auth.uid() = user_id);
create policy "books_delete_own" on public.uploaded_books for delete using (auth.uid() = user_id);

-- subscriptions (read-only for the user; writes happen via service role / webhook)
drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own" on public.subscriptions for select using (auth.uid() = user_id);

-- payments (read-only for the user)
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own" on public.payments for select using (auth.uid() = user_id);

-- api_usage (own rows)
drop policy if exists "usage_select_own" on public.api_usage;
drop policy if exists "usage_insert_own" on public.api_usage;
create policy "usage_select_own" on public.api_usage for select using (auth.uid() = user_id);
create policy "usage_insert_own" on public.api_usage for insert with check (auth.uid() = user_id);

-- Reference tables: readable by everyone (anon + authenticated)
drop policy if exists "plans_read_all"      on public.subscription_plans;
drop policy if exists "industries_read_all" on public.industries;
drop policy if exists "standards_read_all"  on public.standards;
drop policy if exists "compounds_read_all"  on public.chemical_compounds;
create policy "plans_read_all"      on public.subscription_plans for select using (true);
create policy "industries_read_all" on public.industries          for select using (true);
create policy "standards_read_all"  on public.standards           for select using (true);
create policy "compounds_read_all"  on public.chemical_compounds  for select using (true);


-- =============================================================================
-- 7. TRIGGERS: auto-create profile on signup; touch updated_at
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_touch         on public.profiles;
drop trigger if exists saved_formulas_touch   on public.saved_formulas;
drop trigger if exists subscriptions_touch    on public.subscriptions;
create trigger profiles_touch       before update on public.profiles       for each row execute function public.touch_updated_at();
create trigger saved_formulas_touch before update on public.saved_formulas for each row execute function public.touch_updated_at();
create trigger subscriptions_touch  before update on public.subscriptions  for each row execute function public.touch_updated_at();


-- =============================================================================
-- DONE. Verify with:
--   select tablename from pg_tables where schemaname='public' order by tablename;
-- =============================================================================
