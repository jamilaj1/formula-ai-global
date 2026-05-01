-- ============================================================================
-- Formula AI Global - Supabase schema
-- Run this in Supabase Studio -> SQL Editor (one-time setup).
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS and CREATE OR REPLACE.
-- ============================================================================

-- Profiles: extends auth.users with app-level metadata.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  plan text not null default 'starter',  -- starter | professional | business | enterprise
  formulas_used_this_month int not null default 0,
  created_at timestamptz not null default now()
);

-- Search history: every AI query the user runs.
create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  language text not null default 'en',
  result text,
  created_at timestamptz not null default now()
);

create index if not exists search_history_user_created_idx
  on public.search_history (user_id, created_at desc);

-- Saved formulas: the user's curated library.
create table if not exists public.saved_formulas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text,
  components jsonb,
  notes text,
  source_search_id uuid references public.search_history(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists saved_formulas_user_idx
  on public.saved_formulas (user_id);

-- Uploaded books: PDFs the user processed.
create table if not exists public.uploaded_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  size_bytes bigint not null,
  formulas_extracted int not null default 0,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Row-Level Security: every table is private to the owning user.
-- ----------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.search_history  enable row level security;
alter table public.saved_formulas  enable row level security;
alter table public.uploaded_books  enable row level security;

-- profiles: users can read & update only their own row.
drop policy if exists "profiles_select_own"  on public.profiles;
drop policy if exists "profiles_update_own"  on public.profiles;
drop policy if exists "profiles_insert_own"  on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own"
  on public.profiles for insert with check (auth.uid() = id);

-- search_history: full CRUD scoped to the owner.
drop policy if exists "history_select_own"  on public.search_history;
drop policy if exists "history_insert_own"  on public.search_history;
drop policy if exists "history_delete_own"  on public.search_history;
create policy "history_select_own"
  on public.search_history for select using (auth.uid() = user_id);
create policy "history_insert_own"
  on public.search_history for insert with check (auth.uid() = user_id);
create policy "history_delete_own"
  on public.search_history for delete using (auth.uid() = user_id);

-- saved_formulas: full CRUD scoped to the owner.
drop policy if exists "saved_select_own"  on public.saved_formulas;
drop policy if exists "saved_insert_own"  on public.saved_formulas;
drop policy if exists "saved_update_own"  on public.saved_formulas;
drop policy if exists "saved_delete_own"  on public.saved_formulas;
create policy "saved_select_own"
  on public.saved_formulas for select using (auth.uid() = user_id);
create policy "saved_insert_own"
  on public.saved_formulas for insert with check (auth.uid() = user_id);
create policy "saved_update_own"
  on public.saved_formulas for update using (auth.uid() = user_id);
create policy "saved_delete_own"
  on public.saved_formulas for delete using (auth.uid() = user_id);

-- uploaded_books: full CRUD scoped to the owner.
drop policy if exists "books_select_own"  on public.uploaded_books;
drop policy if exists "books_insert_own"  on public.uploaded_books;
drop policy if exists "books_delete_own"  on public.uploaded_books;
create policy "books_select_own"
  on public.uploaded_books for select using (auth.uid() = user_id);
create policy "books_insert_own"
  on public.uploaded_books for insert with check (auth.uid() = user_id);
create policy "books_delete_own"
  on public.uploaded_books for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Auto-create a profile row when a new auth.users row is created.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
