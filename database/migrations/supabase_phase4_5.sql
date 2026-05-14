-- ============================================================
-- Phase 4 + 5: User formula library + book upload / learning
-- Run this in Supabase SQL editor (idempotent — safe to re-run)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- Phase 4: user_formulas — modified copies saved by each user
-- ─────────────────────────────────────────────────────────────
create table if not exists public.user_formulas (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  parent_id       uuid references public.formulas(id) on delete set null,
  name            text not null,
  name_en         text,
  category        text,
  sub_category    text,
  form_type       text,
  description     text,
  components      jsonb not null default '[]'::jsonb,
  process_conditions jsonb default '{}'::jsonb,
  properties      jsonb default '{}'::jsonb,
  trust_score     int default 80,
  notes           text,                              -- user's own notes / why they modified
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists user_formulas_user_id_idx on public.user_formulas(user_id);
create index if not exists user_formulas_parent_id_idx on public.user_formulas(parent_id);
create index if not exists user_formulas_updated_at_idx on public.user_formulas(updated_at desc);

alter table public.user_formulas enable row level security;

drop policy if exists user_formulas_select_own on public.user_formulas;
create policy user_formulas_select_own on public.user_formulas
  for select using (auth.uid() = user_id);

drop policy if exists user_formulas_insert_own on public.user_formulas;
create policy user_formulas_insert_own on public.user_formulas
  for insert with check (auth.uid() = user_id);

drop policy if exists user_formulas_update_own on public.user_formulas;
create policy user_formulas_update_own on public.user_formulas
  for update using (auth.uid() = user_id);

drop policy if exists user_formulas_delete_own on public.user_formulas;
create policy user_formulas_delete_own on public.user_formulas
  for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- Phase 5: uploaded_books + extraction tracking
-- ─────────────────────────────────────────────────────────────
create table if not exists public.uploaded_books (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  author          text,
  year            int,
  file_size_bytes bigint,
  status          text not null default 'pending',  -- pending | processing | done | failed
  formulas_extracted int default 0,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists uploaded_books_user_id_idx on public.uploaded_books(user_id);
create index if not exists uploaded_books_status_idx on public.uploaded_books(status);

alter table public.uploaded_books enable row level security;

drop policy if exists uploaded_books_select_own on public.uploaded_books;
create policy uploaded_books_select_own on public.uploaded_books
  for select using (auth.uid() = user_id);

-- Add attribution columns to public.formulas (so we can credit which book each
-- learned formula came from). Idempotent.
alter table public.formulas
  add column if not exists uploaded_book_id uuid references public.uploaded_books(id) on delete set null,
  add column if not exists added_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists formulas_uploaded_book_id_idx on public.formulas(uploaded_book_id);

-- ─────────────────────────────────────────────────────────────
-- Bookkeeping: bump updated_at on user_formulas / uploaded_books
-- ─────────────────────────────────────────────────────────────
create or replace function public.bump_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists user_formulas_bump_updated_at on public.user_formulas;
create trigger user_formulas_bump_updated_at
  before update on public.user_formulas
  for each row execute function public.bump_updated_at();

drop trigger if exists uploaded_books_bump_updated_at on public.uploaded_books;
create trigger uploaded_books_bump_updated_at
  before update on public.uploaded_books
  for each row execute function public.bump_updated_at();
