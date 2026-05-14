-- ============================================================
-- Phase 13 + 14 + 15: Library, Cost, and Scaling
-- Run in Supabase SQL editor (idempotent)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- ingredient_prices: each user's view of ingredient costs ($/kg)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.ingredient_prices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ingredient_name text not null,
  cas_number      text,
  price_per_kg    numeric(12, 4) not null,
  currency        text not null default 'USD',
  supplier        text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists ingredient_prices_user_id_idx on public.ingredient_prices(user_id);
create index if not exists ingredient_prices_name_idx on public.ingredient_prices(lower(ingredient_name));
create index if not exists ingredient_prices_cas_idx on public.ingredient_prices(cas_number);
create unique index if not exists ingredient_prices_user_name_unique
  on public.ingredient_prices(user_id, lower(ingredient_name));

alter table public.ingredient_prices enable row level security;

drop policy if exists ingredient_prices_select_own on public.ingredient_prices;
create policy ingredient_prices_select_own on public.ingredient_prices
  for select using (auth.uid() = user_id);

drop policy if exists ingredient_prices_insert_own on public.ingredient_prices;
create policy ingredient_prices_insert_own on public.ingredient_prices
  for insert with check (auth.uid() = user_id);

drop policy if exists ingredient_prices_update_own on public.ingredient_prices;
create policy ingredient_prices_update_own on public.ingredient_prices
  for update using (auth.uid() = user_id);

drop policy if exists ingredient_prices_delete_own on public.ingredient_prices;
create policy ingredient_prices_delete_own on public.ingredient_prices
  for delete using (auth.uid() = user_id);

drop trigger if exists ingredient_prices_bump_updated_at on public.ingredient_prices;
create trigger ingredient_prices_bump_updated_at
  before update on public.ingredient_prices
  for each row execute function public.bump_updated_at();
