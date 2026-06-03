-- ─────────────────────────────────────────────────────────────────────
-- user_submissions — community formula uploads (sign-in required).
--
-- ADDITIVE ONLY. Does not touch formulas / imported_formulas / the site.
--
-- Trust model (non-negotiable for a credible site):
--   • Any signed-in user may INSERT a submission (their own only).
--   • A user may read ONLY their own submissions (to see status).
--   • Nothing is public until the owner moderates it. The processing
--     tool extracts structure with Claude; the owner verifies; only
--     then can a row be promoted into the trusted set.
--
-- Run ONCE in Supabase → SQL Editor.
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

create table if not exists user_submissions (
    id              uuid primary key default gen_random_uuid(),
    submitter_id    uuid not null default auth.uid(),
    submitter_email text,

    -- What the user sent
    mode            text check (mode in ('paste','file')) default 'paste',
    title           text,
    product_type    text,
    raw_text        text,            -- pasted recipe OR text/csv file body
    file_name       text,
    file_b64        text,            -- xlsx (base64) when mode='file' & binary
    content_type    text,

    -- Filled by ingestion/process_submissions.py (Claude) — still pending
    parsed          jsonb,           -- {product_type,title,ingredients[],outcome,...}
    confidence      real,
    extracted_model text,
    processed_at    timestamptz,

    -- Owner moderation gate
    review_status   text check (review_status in
                       ('pending','processing','verified','corrected','rejected'))
                       default 'pending',
    reviewed_at     timestamptz,
    review_notes    text,

    created_at      timestamptz default now()
);

create index if not exists usub_status_idx   on user_submissions (review_status);
create index if not exists usub_submitter_idx on user_submissions (submitter_id);
create index if not exists usub_created_idx   on user_submissions (created_at desc);

-- Row Level Security ---------------------------------------------------
alter table user_submissions enable row level security;

-- A signed-in user can submit, but only as themselves.
drop policy if exists usub_insert_own on user_submissions;
create policy usub_insert_own on user_submissions
    for insert to authenticated
    with check (auth.uid() = submitter_id);

-- A user can see only their own submissions (to check review status).
drop policy if exists usub_select_own on user_submissions;
create policy usub_select_own on user_submissions
    for select to authenticated
    using (auth.uid() = submitter_id);

-- No update/delete policies for users → they cannot tamper after submit.
-- The backend (service-role key) bypasses RLS for moderation/processing.

-- Owner view: the queue to review (read via service role in tooling).
create or replace view user_submissions_queue as
    select id, submitter_email, mode, title, product_type,
           left(coalesce(raw_text,''), 200) as preview,
           parsed, confidence, review_status, created_at
    from   user_submissions
    where  review_status in ('pending','processing')
    order  by created_at asc;
