-- ════════════════════════════════════════════════════════════════════
-- CONSULTING-DRAFTS STORAGE BUCKET — Phase 2.3 (2026-05-28)
--
-- Creates a PRIVATE Supabase Storage bucket where the FastAPI backend
-- (`/api/v2/consulting/draft/{id}`) saves the AI-generated markdown
-- drafts before owner approval, and where the finalized PDF is
-- written once Phase 2.5 wires payment confirmation.
--
-- Why private (not public):
-- -------------------------
-- A draft contains the client's product brief, the AI's analysis, and
-- often un-vetted suggestions that need human review BEFORE the client
-- sees them. Public storage would expose half-baked reports if a draft
-- URL leaked. The admin tab + Worker fetch signed URLs that expire
-- after 7 days.
--
-- Safe to re-run (idempotent — uses ON CONFLICT and IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════════════

-- Create the bucket. `public = false` makes it private; only
-- service_role + signed URLs can read.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consulting-drafts',
  'consulting-drafts',
  FALSE,
  10 * 1024 * 1024,                                       -- 10 MB / file
  ARRAY['text/markdown', 'application/pdf', 'text/plain']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS on storage.objects: only service_role (backend) can write, only
-- service_role can read. Signed URLs bypass RLS by design, so the admin
-- tab + Worker delivery still work without any explicit user policy.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND policyname LIKE 'consulting_drafts_%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Service-role inserts (writes). authenticated/anon are blocked by
-- default (no permissive policy = denied).
CREATE POLICY "consulting_drafts_service_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'consulting-drafts'
    AND auth.role() = 'service_role'
  );

CREATE POLICY "consulting_drafts_service_read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'consulting-drafts'
    AND auth.role() = 'service_role'
  );

CREATE POLICY "consulting_drafts_service_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'consulting-drafts'
    AND auth.role() = 'service_role'
  );

CREATE POLICY "consulting_drafts_service_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'consulting-drafts'
    AND auth.role() = 'service_role'
  );

-- Quick verification:
--   SELECT id, name, public FROM storage.buckets WHERE id = 'consulting-drafts';
--   SELECT policyname FROM pg_policies WHERE tablename='objects'
--     AND policyname LIKE 'consulting_drafts_%';
-- ════════════════════════════════════════════════════════════════════
