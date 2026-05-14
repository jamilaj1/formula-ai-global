-- ============================================================
-- Phase 3: Chat AI — schema additions
-- Run this in Supabase SQL editor (idempotent — safe to re-run)
-- ============================================================

-- Chat sessions: one row per user conversation
create table if not exists public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  guest_id    text,                                -- for anonymous chats (IP-derived)
  title       text default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists chat_sessions_user_id_idx on public.chat_sessions(user_id);
create index if not exists chat_sessions_guest_id_idx on public.chat_sessions(guest_id);
create index if not exists chat_sessions_updated_at_idx on public.chat_sessions(updated_at desc);

-- Chat messages: one row per turn (user OR assistant)
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'tool')),
  content     jsonb not null,                      -- {text, tool_calls, tool_results, formula_refs}
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_session_id_idx
  on public.chat_messages(session_id, created_at);

-- RLS: users see their own sessions; guests see by guest_id (matched in worker via header)
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_sessions_select_own on public.chat_sessions;
create policy chat_sessions_select_own on public.chat_sessions
  for select using (auth.uid() = user_id);

drop policy if exists chat_messages_select_own on public.chat_messages;
create policy chat_messages_select_own on public.chat_messages
  for select using (
    session_id in (select id from public.chat_sessions where auth.uid() = user_id)
  );

-- Worker uses the service role key to write, which bypasses RLS.

-- Update touch trigger so chat_sessions.updated_at moves whenever a message is added
create or replace function public.bump_chat_session_updated_at()
returns trigger language plpgsql as $$
begin
  update public.chat_sessions set updated_at = now() where id = new.session_id;
  return new;
end$$;

drop trigger if exists chat_messages_bump_session on public.chat_messages;
create trigger chat_messages_bump_session
  after insert on public.chat_messages
  for each row execute function public.bump_chat_session_updated_at();
