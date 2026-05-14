-- ============================================================
-- Phase 12: Academic & Patent Discovery
-- Run this in Supabase SQL editor (idempotent)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- discovery_jobs: tracks each "Discover" query the user runs
-- ─────────────────────────────────────────────────────────────
create table if not exists public.discovery_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  query           text not null,
  sources         text[] not null default array['semantic_scholar','pubmed','lens','arxiv'],
  status          text not null default 'pending',  -- pending | running | done | failed
  results_found   int default 0,
  formulas_extracted int default 0,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists discovery_jobs_user_id_idx on public.discovery_jobs(user_id);
create index if not exists discovery_jobs_status_idx on public.discovery_jobs(status);

alter table public.discovery_jobs enable row level security;

drop policy if exists discovery_jobs_select_own on public.discovery_jobs;
create policy discovery_jobs_select_own on public.discovery_jobs
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- discovered_sources: every paper/patent we've seen, with metadata
-- ─────────────────────────────────────────────────────────────
create table if not exists public.discovered_sources (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid references public.discovery_jobs(id) on delete set null,
  source_type     text not null,                    -- paper | patent | preprint
  provider        text not null,                    -- semantic_scholar | pubmed | lens | arxiv
  external_id     text,                             -- DOI / patent number / arxiv id
  title           text not null,
  authors         text,
  abstract        text,
  year            int,
  journal_or_office text,                           -- journal name or patent office
  url             text,
  has_formula     boolean default false,            -- did Claude find a formula in it?
  formulas_found  int default 0,
  created_at      timestamptz not null default now()
);

create index if not exists discovered_sources_job_id_idx on public.discovered_sources(job_id);
create index if not exists discovered_sources_external_id_idx on public.discovered_sources(provider, external_id);
create index if not exists discovered_sources_has_formula_idx on public.discovered_sources(has_formula);
create unique index if not exists discovered_sources_dedupe_idx
  on public.discovered_sources(provider, external_id)
  where external_id is not null;

-- Add discovered_source_id to public.formulas (so we can credit each formula)
alter table public.formulas
  add column if not exists discovered_source_id uuid references public.discovered_sources(id) on delete set null;

create index if not exists formulas_discovered_source_id_idx on public.formulas(discovered_source_id);

-- ─────────────────────────────────────────────────────────────
-- Bookkeeping
-- ─────────────────────────────────────────────────────────────
drop trigger if exists discovery_jobs_bump_updated_at on public.discovery_jobs;
create trigger discovery_jobs_bump_updated_at
  before update on public.discovery_jobs
  for each row execute function public.bump_updated_at();
