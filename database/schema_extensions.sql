-- ============================================================
-- Formula AI Global — Schema EXTENSIONS for the global push
-- Run AFTER schema.sql
-- ============================================================

-- 1. Open Formulas Encyclopedia (free, CC-BY-SA-4.0)
CREATE TABLE IF NOT EXISTS open_encyclopedia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formula_id UUID REFERENCES formulas(id) ON DELETE CASCADE UNIQUE,
    is_public BOOLEAN DEFAULT true,
    license VARCHAR(50) DEFAULT 'CC-BY-SA-4.0',
    download_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Gold Standard certifications
CREATE TABLE IF NOT EXISTS gold_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formula_id UUID REFERENCES formulas(id) ON DELETE CASCADE,
    certified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    certification_date TIMESTAMP DEFAULT NOW(),
    certificate_hash VARCHAR(64) UNIQUE NOT NULL,
    validation_stages JSONB DEFAULT '[]',
    expires_at TIMESTAMP
);

-- 3. University Program (free Enterprise for academia)
CREATE TABLE IF NOT EXISTS university_program (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    university_name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    max_students INTEGER DEFAULT 500,
    active_until DATE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Industrial API keys (factories integrating with their ERPs)
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'starter',
    calls_limit INTEGER DEFAULT 1000,
    calls_used INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP
);

-- 5. Ready Recipes (small-factory turnkey packs)
CREATE TABLE IF NOT EXISTS ready_recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formula_id UUID REFERENCES formulas(id) ON DELETE CASCADE,
    video_url TEXT,
    local_suppliers JSONB DEFAULT '[]',
    difficulty_level VARCHAR(20) DEFAULT 'beginner',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 6. 30-Day Challenges
CREATE TABLE IF NOT EXISTS challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    prize VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT NOW(),
    progress JSONB DEFAULT '{}',
    completed BOOLEAN DEFAULT false
);

-- 7. Global Conference (annual virtual event)
CREATE TABLE IF NOT EXISTS global_conference (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255),
    event_date DATE,
    registration_url TEXT,
    speakers JSONB DEFAULT '[]',
    sponsors JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_open_enc_public        ON open_encyclopedia(is_public);
CREATE INDEX IF NOT EXISTS idx_gold_hash              ON gold_certifications(certificate_hash);
CREATE INDEX IF NOT EXISTS idx_university_domain      ON university_program(domain);
CREATE INDEX IF NOT EXISTS idx_apikey_user            ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_apikey_active          ON api_keys(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_recipe_formula         ON ready_recipes(formula_id);

-- ============================================================
-- Helper RPC: list public formulas with their open-encyc metadata
-- ============================================================
CREATE OR REPLACE FUNCTION get_public_formulas(limit_count INT DEFAULT 50, offset_count INT DEFAULT 0)
RETURNS TABLE (
    id UUID,
    name TEXT,
    name_en TEXT,
    category VARCHAR,
    components JSONB,
    trust_score FLOAT,
    license VARCHAR,
    download_count INTEGER
) LANGUAGE sql STABLE AS $$
    SELECT f.id, f.name, f.name_en, f.category, f.components, f.trust_score,
           oe.license, oe.download_count
      FROM open_encyclopedia oe
      JOIN formulas f ON f.id = oe.formula_id
     WHERE oe.is_public = true
     ORDER BY oe.created_at DESC
     LIMIT limit_count OFFSET offset_count;
$$;

CREATE OR REPLACE FUNCTION get_recipes_by_country(country VARCHAR)
RETURNS SETOF ready_recipes LANGUAGE sql STABLE AS $$
    SELECT *
      FROM ready_recipes
     WHERE EXISTS (
        SELECT 1
          FROM jsonb_array_elements(local_suppliers) AS s
         WHERE upper(s->>'country') = upper(country)
     );
$$;

-- ============================================================
-- Increment helpers (so we don't race-condition counters)
-- ============================================================
CREATE OR REPLACE FUNCTION increment_ad_impression(ad_id_param UUID)
RETURNS void LANGUAGE sql AS $$
    UPDATE direct_ads SET total_impressions = COALESCE(total_impressions, 0) + 1
     WHERE id = ad_id_param;
$$;

CREATE OR REPLACE FUNCTION increment_ad_click(ad_id_param UUID)
RETURNS void LANGUAGE sql AS $$
    UPDATE direct_ads SET total_clicks = COALESCE(total_clicks, 0) + 1
     WHERE id = ad_id_param;
$$;
