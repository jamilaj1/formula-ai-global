-- =============================================================================
-- Formula AI Global — Master Formula Library (ADDON)
-- =============================================================================
-- Run AFTER the main schema. This adds the master library of 3,381+ formulas
-- (Jamil's personal collection) without touching any existing table.
-- Idempotent: safe to re-run.
-- =============================================================================

-- =============================================================================
-- 1. master_formulas — the heart of the platform
-- =============================================================================
create table if not exists public.master_formulas (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now()
);

-- Idempotent column additions
alter table public.master_formulas add column if not exists code            text;          -- "FA-2026-X00001"
alter table public.master_formulas add column if not exists name_en         text;
alter table public.master_formulas add column if not exists name_ar         text;
alter table public.master_formulas add column if not exists category        text;          -- normalised category
alter table public.master_formulas add column if not exists sub_category    text;
alter table public.master_formulas add column if not exists form_type       text;          -- liquid, cream, gel, …
alter table public.master_formulas add column if not exists description     text;
alter table public.master_formulas add column if not exists components      jsonb not null default '[]'::jsonb;
alter table public.master_formulas add column if not exists process_conditions jsonb default '{}'::jsonb;
alter table public.master_formulas add column if not exists properties      jsonb default '{}'::jsonb;
alter table public.master_formulas add column if not exists safety_warnings jsonb default '[]'::jsonb;
alter table public.master_formulas add column if not exists source          jsonb default '{}'::jsonb;
alter table public.master_formulas add column if not exists compliance      jsonb default '[]'::jsonb;
alter table public.master_formulas add column if not exists trust_score     int  default 88;
alter table public.master_formulas add column if not exists multi_part      int;           -- null=1-part, 2 = Part A+B, …
alter table public.master_formulas add column if not exists notes           text;
alter table public.master_formulas add column if not exists is_published    boolean not null default true;
alter table public.master_formulas add column if not exists view_count      int  not null default 0;
alter table public.master_formulas add column if not exists save_count      int  not null default 0;
alter table public.master_formulas add column if not exists updated_at      timestamptz not null default now();

-- Unique code (Jamil's "FA-2026-Xnnnn" identifier)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'master_formulas_code_key')
    and exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='master_formulas' and column_name='code') then
    alter table public.master_formulas add constraint master_formulas_code_key unique (code);
  end if;
end$$;

-- Indexes for fast search
create index if not exists master_formulas_code_idx        on public.master_formulas (code);
create index if not exists master_formulas_category_idx    on public.master_formulas (category);
create index if not exists master_formulas_form_idx        on public.master_formulas (form_type);
create index if not exists master_formulas_published_idx   on public.master_formulas (is_published) where is_published = true;
create index if not exists master_formulas_name_en_trgm    on public.master_formulas using gin (name_en gin_trgm_ops);
create index if not exists master_formulas_name_ar_trgm    on public.master_formulas using gin (name_ar gin_trgm_ops);

-- Components GIN index — searches inside the JSONB array
create index if not exists master_formulas_components_idx  on public.master_formulas using gin (components);

-- Need pg_trgm for fuzzy search above
create extension if not exists pg_trgm;


-- =============================================================================
-- 2. RLS — world-readable for published formulas (read), service-role only writes
-- =============================================================================
alter table public.master_formulas enable row level security;

drop policy if exists "master_formulas_read_published" on public.master_formulas;
create policy "master_formulas_read_published"
  on public.master_formulas
  for select
  using (is_published = true);


-- =============================================================================
-- 3. updated_at trigger
-- =============================================================================
drop trigger if exists master_formulas_touch on public.master_formulas;
create trigger master_formulas_touch
  before update on public.master_formulas
  for each row execute function public.touch_updated_at();


-- =============================================================================
-- DONE.
-- Verify with:
--   select count(*) from public.master_formulas;
-- =============================================================================
