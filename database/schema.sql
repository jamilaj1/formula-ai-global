-- =============================================================================
-- Formula AI Global - Complete Database Schema (migration-safe)
-- =============================================================================
-- Run in Supabase Studio -> SQL Editor.
-- Idempotent AND migration-safe: even if older versions of these tables already
-- exist with different columns, this script will ADD any missing columns
-- before inserting data.
-- =============================================================================

-- Required extensions ---------------------------------------------------------
create extension if not exists "pgcrypto";  -- for gen_random_uuid()


-- =============================================================================
-- 1. CORE: profiles
-- =============================================================================
create table if not exists public.profiles (
  id                          uuid primary key references auth.users(id) on delete cascade,
  created_at                  timestamptz not null default now()
);

alter table public.profiles add column if not exists email                       text;
alter table public.profiles add column if not exists full_name                   text;
alter table public.profiles add column if not exists avatar_url                  text;
alter table public.profiles add column if not exists plan                        text not null default 'starter';
alter table public.profiles add column if not exists formulas_used_this_month    int  not null default 0;
alter table public.profiles add column if not exists monthly_quota_resets_at     timestamptz not null default (now() + interval '1 month');
alter table public.profiles add column if not exists stripe_customer_id          text;
alter table public.profiles add column if not exists updated_at                  timestamptz not null default now();

create index if not exists profiles_stripe_customer_idx on public.profiles (stripe_customer_id);
create index if not exists profiles_email_idx on public.profiles (email);


-- =============================================================================
-- 2. CONTENT: search_history, saved_formulas, uploaded_books
-- =============================================================================
create table if not exists public.search_history (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.search_history add column if not exists query       text;
alter table public.search_history add column if not exists language    text not null default 'en';
alter table public.search_history add column if not exists result      text;
alter table public.search_history add column if not exists tokens_in   int;
alter table public.search_history add column if not exists tokens_out  int;
create index if not exists search_history_user_created_idx
  on public.search_history (user_id, created_at desc);


create table if not exists public.saved_formulas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.saved_formulas add column if not exists name              text;
alter table public.saved_formulas add column if not exists category          text;
alter table public.saved_formulas add column if not exists components        jsonb;
alter table public.saved_formulas add column if not exists notes             text;
alter table public.saved_formulas add column if not exists source_search_id  uuid;
alter table public.saved_formulas add column if not exists trust_score       int default 100;
alter table public.saved_formulas add column if not exists is_public         boolean not null default false;
alter table public.saved_formulas add column if not exists updated_at        timestamptz not null default now();
create index if not exists saved_formulas_user_idx on public.saved_formulas (user_id);
create index if not exists saved_formulas_category_idx on public.saved_formulas (category);


create table if not exists public.uploaded_books (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.uploaded_books add column if not exists filename            text;
alter table public.uploaded_books add column if not exists size_bytes          bigint;
alter table public.uploaded_books add column if not exists pages               int;
alter table public.uploaded_books add column if not exists formulas_extracted  int not null default 0;
alter table public.uploaded_books add column if not exists status              text not null default 'completed';
create index if not exists uploaded_books_user_idx on public.uploaded_books (user_id);


-- =============================================================================
-- 3. BILLING: subscription_plans, subscriptions, payments
-- =============================================================================
create table if not exists public.subscription_plans (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

-- Older schemas may already have this table with different columns. Add every
-- column we reference, only if it's missing.
alter table public.subscription_plans add column if not exists slug             text;
alter table public.subscription_plans add column if not exists name             text;
alter table public.subscription_plans add column if not exists price_monthly    decimal(10,2) default 0;
alter table public.subscription_plans add column if not exists price_yearly     decimal(10,2);
alter table public.subscription_plans add column if not exists currency         varchar(3) default 'USD';
alter table public.subscription_plans add column if not exists formula_quota    int default 10;
alter table public.subscription_plans add column if not exists upload_quota_mb  int default 0;
alter table public.subscription_plans add column if not exists features         jsonb;
alter table public.subscription_plans add column if not exists stripe_price_id  text;
alter table public.subscription_plans add column if not exists is_active        boolean not null default true;

-- Make slug the natural key. Skip silently if the constraint already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscription_plans_slug_key'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='subscription_plans' and column_name='slug'
  ) then
    alter table public.subscription_plans add constraint subscription_plans_slug_key unique (slug);
  end if;
end$$;

-- Seed the four canonical plans (idempotent on the slug).

-- Relax NOT NULL on every legacy column we don't explicitly set in INSERTs.
-- Idempotent: drop_not_null is a no-op if already nullable.
do $$
declare col record;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema='public' and table_name='subscription_plans'
      and is_nullable='NO' and column_name not in ('id','created_at','user_id','plan_id')
  loop
    execute format('alter table public.subscription_plans alter column %I drop not null', col.column_name);
  end loop;
end$$;

insert into public.subscription_plans (slug, name, price_monthly, formula_quota, features) values
  ('starter',      'Starter',      0,    10,   '["Basic search","PDF export","10 formulas/month"]'::jsonb),
  ('professional', 'Professional', 49,   100,  '["Advanced AI","API access","100 formulas/month"]'::jsonb),
  ('business',     'Business',     299,  -1,   '["Unlimited formulas","Team access","24/7 support"]'::jsonb),
  ('enterprise',   'Enterprise',   999,  -1,   '["Everything","On-premise","Custom development"]'::jsonb)
on conflict (slug) do nothing;


create table if not exists public.subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.subscriptions add column if not exists plan_id                  uuid;
alter table public.subscriptions add column if not exists status                   text not null default 'active';
alter table public.subscriptions add column if not exists stripe_subscription_id   text;
alter table public.subscriptions add column if not exists current_period_start     timestamptz;
alter table public.subscriptions add column if not exists current_period_end       timestamptz;
alter table public.subscriptions add column if not exists cancel_at_period_end     boolean not null default false;
alter table public.subscriptions add column if not exists updated_at               timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_stripe_subscription_id_key'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='subscriptions' and column_name='stripe_subscription_id'
  ) then
    alter table public.subscriptions add constraint subscriptions_stripe_subscription_id_key unique (stripe_subscription_id);
  end if;
end$$;

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);


create table if not exists public.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.payments add column if not exists plan_id                  uuid;
alter table public.payments add column if not exists amount                   decimal(10,2);
alter table public.payments add column if not exists currency                 varchar(3) default 'USD';
alter table public.payments add column if not exists status                   text;
alter table public.payments add column if not exists payment_method           varchar(50);
alter table public.payments add column if not exists stripe_payment_intent_id varchar(100);
alter table public.payments add column if not exists stripe_invoice_id        varchar(100);
alter table public.payments add column if not exists stripe_receipt_url       text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_stripe_payment_intent_id_key'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='payments' and column_name='stripe_payment_intent_id'
  ) then
    alter table public.payments add constraint payments_stripe_payment_intent_id_key unique (stripe_payment_intent_id);
  end if;
end$$;

create index if not exists payments_user_idx on public.payments (user_id);
create index if not exists payments_status_idx on public.payments (status);


-- =============================================================================
-- 4. METADATA: industries, standards, chemical_compounds (reference data)
-- =============================================================================
create table if not exists public.industries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);
alter table public.industries add column if not exists slug         text;
alter table public.industries add column if not exists name         text;
alter table public.industries add column if not exists description  text;
alter table public.industries add column if not exists icon         text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'industries_slug_key')
    and exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='industries' and column_name='slug') then
    alter table public.industries add constraint industries_slug_key unique (slug);
  end if;
end$$;


-- Relax NOT NULL on every legacy column we don't explicitly set in INSERTs.
-- Idempotent: drop_not_null is a no-op if already nullable.
do $$
declare col record;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema='public' and table_name='industries'
      and is_nullable='NO' and column_name not in ('id','created_at','user_id','plan_id')
  loop
    execute format('alter table public.industries alter column %I drop not null', col.column_name);
  end loop;
end$$;

insert into public.industries (slug, name, description) values
  ('cosmetics',     'Cosmetics',          'Personal care, skin care, hair care'),
  ('cleaning',      'Cleaning Products',  'Detergents, disinfectants, surface cleaners'),
  ('automotive',    'Automotive',         'Car shampoos, polishes, coolants'),
  ('industrial',    'Industrial',         'Lubricants, coatings, solvents'),
  ('food',          'Food & Beverage',    'Food-grade additives and processing aids'),
  ('agriculture',   'Agriculture',        'Fertilizers, pesticides, plant nutrients'),
  ('pharmaceutical','Pharmaceutical',     'Excipients and topical formulations'),
  ('textile',       'Textile',            'Fabric softeners, dyes, finishing agents')
on conflict (slug) do nothing;


create table if not exists public.standards (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);
alter table public.standards add column if not exists code         text;
alter table public.standards add column if not exists name         text;
alter table public.standards add column if not exists region       text;
alter table public.standards add column if not exists description  text;
alter table public.standards add column if not exists url          text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'standards_code_key')
    and exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='standards' and column_name='code') then
    alter table public.standards add constraint standards_code_key unique (code);
  end if;
end$$;


-- Relax NOT NULL on every legacy column we don't explicitly set in INSERTs.
-- Idempotent: drop_not_null is a no-op if already nullable.
do $$
declare col record;
begin
  for col in
    select column_name from information_schema.columns
    where table_schema='public' and table_name='standards'
      and is_nullable='NO' and column_name not in ('id','created_at','user_id','plan_id')
  loop
    execute format('alter table public.standards alter column %I drop not null', col.column_name);
  end loop;
end$$;

insert into public.standards (code, name, region, description) values
  ('EU-1223',    'EU Cosmetic Regulation 1223/2009', 'EU',     'Cosmetic products in the European Union'),
  ('FDA-CFR-21', 'FDA 21 CFR',                       'US',     'US Food, Drug & Cosmetic regulations'),
  ('REACH',      'REACH',                            'EU',     'EU chemical registration framework'),
  ('GHS',        'Globally Harmonized System',       'global', 'Hazard classification and labeling'),
  ('ISO-22716',  'ISO 22716',                        'global', 'GMP for cosmetics'),
  ('GSO-1943',   'GSO 1943',                         'GCC',    'Gulf cosmetic safety standard')
on conflict (code) do nothing;


create table if not exists public.chemical_compounds (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);
alter table public.chemical_compounds add column if not exists cas_number        text;
alter table public.chemical_compounds add column if not exists name              text;
alter table public.chemical_compounds add column if not exists iupac_name        text;
alter table public.chemical_compounds add column if not exists formula           text;
alter table public.chemical_compounds add column if not exists molecular_weight  decimal(10,4);
alter table public.chemical_compounds add column if not exists typical_function  text;
alter table public.chemical_compounds add column if not exists hazard_class      text;
alter table public.chemical_compounds add column if not exists pubchem_cid       int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chemical_compounds_cas_number_key')
    and exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='chemical_compounds' and column_name='cas_number') then
    alter table public.chemical_compounds add constraint chemical_compounds_cas_number_key unique (cas_number);
  end if;
end$$;

create index if not exists compounds_cas_idx on public.chemical_compounds (cas_number);
create index if not exists compounds_name_idx on public.chemical_compounds (name);


-- =============================================================================
-- 5. USAGE TRACKING
-- =============================================================================
create table if not exists public.api_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.api_usage add column if not exists endpoint    text;
alter table public.api_usage add column if not exists status_code int;
alter table public.api_usage add column if not exists duration_ms int;
alter table public.api_usage add column if not exists tokens_in   int;
alter table public.api_usage add column if not exists tokens_out  int;
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
alter table public.subscription_plans  enable row level security;
alter table public.industries          enable row level security;
alter table public.standards           enable row level security;
alter table public.chemical_compounds  enable row level security;

-- profiles
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

-- saved_formulas
drop policy if exists "saved_select_own"    on public.saved_formulas;
drop policy if exists "saved_select_public" on public.saved_formulas;
drop policy if exists "saved_insert_own"    on public.saved_formulas;
drop policy if exists "saved_update_own"    on public.saved_formulas;
drop policy if exists "saved_delete_own"    on public.saved_formulas;
create policy "saved_select_own"    on public.saved_formulas for select using (auth.uid() = user_id);
create policy "saved_select_public" on public.saved_formulas for select using (is_public = true);
create policy "saved_insert_own"    on public.saved_formulas for insert with check (auth.uid() = user_id);
create policy "saved_update_own"    on public.saved_formulas for update using (auth.uid() = user_id);
create policy "saved_delete_own"    on public.saved_formulas for delete using (auth.uid() = user_id);

-- uploaded_books
drop policy if exists "books_select_own" on public.uploaded_books;
drop policy if exists "books_insert_own" on public.uploaded_books;
drop policy if exists "books_delete_own" on public.uploaded_books;
create policy "books_select_own" on public.uploaded_books for select using (auth.uid() = user_id);
create policy "books_insert_own" on public.uploaded_books for insert with check (auth.uid() = user_id);
create policy "books_delete_own" on public.uploaded_books for delete using (auth.uid() = user_id);

-- subscriptions / payments (read-only for owner; writes via service role)
drop policy if exists "subs_select_own"     on public.subscriptions;
drop policy if exists "payments_select_own" on public.payments;
create policy "subs_select_own"     on public.subscriptions for select using (auth.uid() = user_id);
create policy "payments_select_own" on public.payments      for select using (auth.uid() = user_id);

-- api_usage
drop policy if exists "usage_select_own" on public.api_usage;
drop policy if exists "usage_insert_own" on public.api_usage;
create policy "usage_select_own" on public.api_usage for select using (auth.uid() = user_id);
create policy "usage_insert_own" on public.api_usage for insert with check (auth.uid() = user_id);

-- Reference tables: world-readable
drop policy if exists "plans_read_all"      on public.subscription_plans;
drop policy if exists "industries_read_all" on public.industries;
drop policy if exists "standards_read_all"  on public.standards;
drop policy if exists "compounds_read_all"  on public.chemical_compounds;
create policy "plans_read_all"      on public.subscription_plans for select using (true);
create policy "industries_read_all" on public.industries          for select using (true);
create policy "standards_read_all"  on public.standards           for select using (true);
create policy "compounds_read_all"  on public.chemical_compounds  for select using (true);


-- =============================================================================
-- 7. TRIGGERS
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
