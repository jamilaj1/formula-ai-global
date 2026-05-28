-- ════════════════════════════════════════════════════════════════════
-- WORKSPACE EXTENSIONS for user_formulas — Phase 4 (2026-05-28)
--
-- The user_formulas table already exists (Phase 4_5 migration). Phase 4
-- of the $50K roadmap adds light project + tag organisation on top of
-- it, so chemists can group their saved recipes (e.g. "Cosmetics line",
-- "Cleaning R&D 2026") and filter by colour-coded tags ("WIP",
-- "approved", "blocked").
--
-- What this builds
-- ----------------
--   1. `project` TEXT column on user_formulas. NULL = "unfiled".
--   2. `tags` TEXT[] column with a GIN index for fast contains-queries.
--   3. View `user_formula_projects` that returns each user's distinct
--      projects with their formula count, used by workspace.html for
--      the left-sidebar.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.user_formulas
  ADD COLUMN IF NOT EXISTS project TEXT,
  ADD COLUMN IF NOT EXISTS tags    TEXT[] NOT NULL DEFAULT '{}';

-- Project filter (frequent: list all formulas under a given project).
CREATE INDEX IF NOT EXISTS user_formulas_user_project_idx
  ON public.user_formulas (user_id, project)
  WHERE project IS NOT NULL;

-- GIN on tags lets us answer "all formulas tagged WIP" in O(matches).
CREATE INDEX IF NOT EXISTS user_formulas_tags_gin_idx
  ON public.user_formulas USING GIN (tags);

COMMENT ON COLUMN public.user_formulas.project IS
  'Phase 4 grouping — free-form name set by the user in workspace.html. NULL = "unfiled".';
COMMENT ON COLUMN public.user_formulas.tags IS
  'Phase 4 lightweight tagging — e.g. {"wip","approved","blocked"}. Owner-defined per workspace.';

-- View: project summary per user
DROP VIEW IF EXISTS public.user_formula_projects;
CREATE VIEW public.user_formula_projects WITH (security_invoker = true) AS
  SELECT
    user_id,
    COALESCE(project, '(unfiled)') AS project,
    COUNT(*)                       AS formula_count,
    MAX(updated_at)                AS last_updated
  FROM public.user_formulas
  GROUP BY user_id, COALESCE(project, '(unfiled)');

GRANT SELECT ON public.user_formula_projects TO authenticated;

-- Quick verification (signed-in as a user that owns rows):
--   SELECT project, formula_count FROM user_formula_projects WHERE user_id = auth.uid();
-- ════════════════════════════════════════════════════════════════════
