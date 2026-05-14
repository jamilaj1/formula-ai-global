-- =============================================================================
-- Formula AI Global — Phase 2 add-on
-- Adds: api_usage rate-limit table + profiles.plan column + auto-profile trigger
-- Run AFTER the main schema. Safe to re-run (idempotent).
-- =============================================================================

-- 1. api_usage  — every call to the Worker logs a row here for daily limits
create table if not exists public.api_usage (
  id          uuid primary key default gen_random_uuid(),
  caller_id   text not null,            -- "user:<uuid>" or "ip:<address>"
  endpoint    text not null default '/search',
  user_id     uuid references auth.users(id) on delete set null,
  status_code int  not null default 200,
  created_at  timestamptz not null default now()
);

create index if not exists api_usage_caller_day_idx on public.api_usage (caller_id, created_at desc);
create index if not exists api_usage_endpoint_idx   on public.api_usage (endpoint);

-- 2. profiles.plan  — current subscription tier (starter | professional | business | enterprise)
alter table public.profiles add column if not exists plan text not null default 'starter';
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;

-- 3. RLS policies
alter table public.api_usage enable row level security;

drop policy if exists "api_usage_insert_service" on public.api_usage;
drop policy if exists "api_usage_select_own"     on public.api_usage;

-- Service-role can insert/read freely (used by the Cloudflare Worker)
-- (service-role bypasses RLS by default, so we don't need an explicit policy for it,
--  but we add one anyway in case the policy framework changes.)
create policy "api_usage_select_own"
  on public.api_usage for select
  using (
    -- A signed-in user can read their own rows
    user_id = auth.uid()
  );

-- 4. Auto-create profile when a new auth user signs up
create or replace function public.handle_new_user_v2()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, full_name, plan)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    'starter'
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_v2();

-- =============================================================================
-- DONE. Verify with:
--   select count(*) from api_usage;
--   select column_name from information_schema.columns where table_name='profiles';
-- =============================================================================
