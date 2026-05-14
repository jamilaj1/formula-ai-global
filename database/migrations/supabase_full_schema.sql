-- ═══════════════════════════════════════════════════════
-- Formula AI Global — Complete Database Schema
-- Run this once in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ─── PART 1: Core schema ─────────────────────────────
-- ============================================================
-- Formula AI Global — Core schema
-- Run in Supabase: Project → SQL Editor → paste → Run
-- ============================================================

-- Required extensions ----------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    full_name VARCHAR(255),
    company_name VARCHAR(255),
    country VARCHAR(100),
    phone VARCHAR(50),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT true,
    is_admin BOOLEAN DEFAULT false,
    subscription_plan_id UUID,
    subscription_status VARCHAR(50) DEFAULT 'inactive',
    subscription_start_date TIMESTAMP,
    subscription_end_date TIMESTAMP,
    stripe_customer_id VARCHAR(100),
    stripe_subscription_id VARCHAR(100),
    formulas_used_this_month INTEGER DEFAULT 0,
    api_calls_today INTEGER DEFAULT 0,
    language VARCHAR(10) DEFAULT 'en',
    theme VARCHAR(10) DEFAULT 'dark',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 2. SUBSCRIPTION PLANS
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    price_monthly DECIMAL(10,2) NOT NULL,
    price_yearly DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    formulas_per_month INTEGER,
    api_calls_per_day INTEGER,
    has_api_access BOOLEAN DEFAULT false,
    has_advanced_search BOOLEAN DEFAULT false,
    has_export BOOLEAN DEFAULT false,
    has_no_ads BOOLEAN DEFAULT false,
    has_white_label BOOLEAN DEFAULT false,
    features JSONB DEFAULT '{}',
    stripe_price_id_monthly VARCHAR(100),
    stripe_price_id_yearly VARCHAR(100),
    stripe_product_id VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- FK to users now that the table exists
ALTER TABLE users
    ADD CONSTRAINT users_plan_fk
    FOREIGN KEY (subscription_plan_id)
    REFERENCES subscription_plans(id)
    ON DELETE SET NULL;

-- ============================================================
-- 3. FORMULAS (the heart)
-- ============================================================
CREATE TABLE IF NOT EXISTS formulas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_en TEXT,
    category VARCHAR(100),
    sub_category VARCHAR(100),
    form_type VARCHAR(50),
    description TEXT,
    components JSONB DEFAULT '[]',
    process_conditions JSONB DEFAULT '{}',
    final_properties JSONB DEFAULT '{}',
    safety_warnings JSONB DEFAULT '[]',
    quality_control JSONB DEFAULT '[]',
    applications JSONB DEFAULT '[]',
    scientific_basis TEXT,
    source_type VARCHAR(50),
    source_title VARCHAR(255),
    source_author VARCHAR(255),
    source_year INTEGER,
    source_page INTEGER,
    source_url TEXT,
    source_doi VARCHAR(255),
    source_patent_number VARCHAR(100),
    source_confidence FLOAT DEFAULT 0,
    is_complete BOOLEAN DEFAULT false,
    completeness_score FLOAT DEFAULT 0,
    trust_score FLOAT DEFAULT 0,
    environmental_score FLOAT DEFAULT 0,
    cost_score FLOAT DEFAULT 0,
    quality_score FLOAT DEFAULT 0,
    economic_level VARCHAR(20),
    cost_per_kg DECIMAL(10,2),
    human_verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    search_count INTEGER DEFAULT 0,
    save_count INTEGER DEFAULT 0,
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 4. CHEMICALS DATABASE  (CAS lookup, hazards, prices)
-- ============================================================
CREATE TABLE IF NOT EXISTS chemicals_database (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    name_en TEXT,
    iupac_name TEXT,
    cas_number VARCHAR(20),
    molecular_formula VARCHAR(100),
    molecular_weight DECIMAL,
    smiles TEXT,
    inchi TEXT,
    category VARCHAR(100),
    function_category VARCHAR(100),
    physical_properties JSONB DEFAULT '{}',
    synonyms JSONB DEFAULT '[]',
    hazards JSONB DEFAULT '{}',
    common_applications JSONB DEFAULT '[]',
    typical_percentage_range JSONB DEFAULT '{}',
    average_price_per_kg DECIMAL(10,2),
    is_eco_friendly BOOLEAN DEFAULT false,
    is_banned_in_countries JSONB DEFAULT '[]',
    source VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 5. FOREVER CHAT HISTORY  (never auto-deleted)
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(100),
    message TEXT NOT NULL,
    response TEXT NOT NULL,
    language VARCHAR(10) DEFAULT 'en',
    formulas_referenced JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- User saved formulas + search history
CREATE TABLE IF NOT EXISTS user_saved_formulas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    formula_id UUID REFERENCES formulas(id) ON DELETE CASCADE,
    notes TEXT,
    tags JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    language VARCHAR(10),
    results_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 6. SOURCES QUEUE (knowledge collector input)
-- ============================================================
CREATE TABLE IF NOT EXISTS sources_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50),                    -- book / patent / journal / site
    title VARCHAR(500),
    author VARCHAR(255),
    url TEXT,
    raw_text TEXT,
    metadata JSONB DEFAULT '{}',
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 7. INDUSTRIES, REGULATORY BODIES, STANDARDS, LIMITS
-- ============================================================
CREATE TABLE IF NOT EXISTS industry_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    description TEXT,
    icon VARCHAR(100),
    priority INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS industries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES industry_categories(id),
    code VARCHAR(20) UNIQUE NOT NULL,
    name_en VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255) NOT NULL,
    products_count INTEGER DEFAULT 0,
    formulas_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS regulatory_bodies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    abbreviation VARCHAR(50) UNIQUE NOT NULL,
    country VARCHAR(100),
    country_iso VARCHAR(3),
    website VARCHAR(255),
    jurisdiction TEXT,
    enforcement_power BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS product_standards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_category VARCHAR(100),
    standard_code VARCHAR(100),
    standard_name TEXT,
    issuing_body VARCHAR(255),
    country VARCHAR(100),
    country_iso VARCHAR(3),
    requirements JSONB DEFAULT '{}',
    test_methods JSONB DEFAULT '[]',
    limits JSONB DEFAULT '{}',
    last_updated DATE,
    is_mandatory BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS chemical_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chemical_name VARCHAR(255),
    cas_number VARCHAR(20),
    country VARCHAR(100),
    country_iso VARCHAR(3),
    product_category VARCHAR(100),
    regulatory_body VARCHAR(255),
    limit_type VARCHAR(50),
    limit_value DECIMAL(10,4),
    limit_unit VARCHAR(20),
    condition_text TEXT,
    reference_standard VARCHAR(255),
    effective_date DATE
);

-- ============================================================
-- 8. PAYMENTS + ADS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    plan_id UUID REFERENCES subscription_plans(id),
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    status VARCHAR(50),
    payment_method VARCHAR(50),
    stripe_payment_intent_id VARCHAR(100),
    stripe_invoice_id VARCHAR(100),
    stripe_receipt_url TEXT,
    billing_period_start TIMESTAMP,
    billing_period_end TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS direct_ads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_name VARCHAR(255),
    advertiser_company VARCHAR(255),
    ad_type VARCHAR(50),
    ad_title TEXT,
    ad_description TEXT,
    ad_image_url TEXT,
    ad_link_url TEXT,
    ad_position VARCHAR(50),
    start_date DATE,
    end_date DATE,
    budget DECIMAL(10,2),
    cost_per_click DECIMAL(10,2),
    total_clicks INTEGER DEFAULT 0,
    total_impressions INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 9. LEARNING LOG (brain self-improvement audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS learning_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50),
    description TEXT,
    data JSONB DEFAULT '{}',
    impact_score FLOAT DEFAULT 0,
    formulas_affected INTEGER DEFAULT 0,
    new_rules_added INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 10. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_formulas_category ON formulas(category);
CREATE INDEX IF NOT EXISTS idx_formulas_type     ON formulas(form_type);
CREATE INDEX IF NOT EXISTS idx_formulas_trust    ON formulas(trust_score);
CREATE INDEX IF NOT EXISTS idx_formulas_economic ON formulas(economic_level);
CREATE INDEX IF NOT EXISTS idx_chem_name         ON chemicals_database(name);
CREATE INDEX IF NOT EXISTS idx_chem_cas          ON chemicals_database(cas_number);
CREATE INDEX IF NOT EXISTS idx_chat_user         ON chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_session      ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_search_user       ON user_search_history(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_user        ON user_saved_formulas(user_id);
CREATE INDEX IF NOT EXISTS idx_limits_country    ON chemical_limits(country_iso);
CREATE INDEX IF NOT EXISTS idx_sources_pending   ON sources_queue(processed) WHERE processed = false;

-- ─── PART 2: Compliance & extensions ─────────────────
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

-- ─── PART 3: AI Brain v2 tables ──────────────────────
-- ============================================================
-- Formula AI Global - Schema Extensions for v2 Engines
-- Adds tables for LearningEngine, KnowledgeGraph, VirtualLab, etc.
-- Run AFTER the original schema.
-- ============================================================

-- 1. Learning rules (LearningEngine)
CREATE TABLE IF NOT EXISTS learning_rules (
    rule_id        VARCHAR(16) PRIMARY KEY,
    condition      TEXT NOT NULL,
    action         TEXT NOT NULL,
    confidence     FLOAT DEFAULT 0.6,
    evidence_count INTEGER DEFAULT 1,
    success_rate   FLOAT DEFAULT 0.5,
    created_at     TIMESTAMP DEFAULT NOW(),
    last_applied   TIMESTAMP DEFAULT NOW(),
    source_formulas JSONB DEFAULT '[]',
    user_feedback  JSONB DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_learning_confidence ON learning_rules(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_learning_success ON learning_rules(success_rate DESC);

-- 2. Knowledge graph nodes
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    node_id      VARCHAR(100) PRIMARY KEY,
    node_type    VARCHAR(50) NOT NULL,
    display_name VARCHAR(255),
    properties   JSONB DEFAULT '{}',
    safety_profile VARCHAR(50),
    cost_tier    VARCHAR(20),
    created_at   TIMESTAMP DEFAULT NOW()
);

-- 3. Knowledge graph edges
CREATE TABLE IF NOT EXISTS knowledge_edges (
    edge_id      SERIAL PRIMARY KEY,
    source_node  VARCHAR(100) REFERENCES knowledge_nodes(node_id) ON DELETE CASCADE,
    relation_type VARCHAR(50) NOT NULL,
    target_node  VARCHAR(100) REFERENCES knowledge_nodes(node_id) ON DELETE CASCADE,
    confidence   FLOAT DEFAULT 0.8,
    created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_edges(source_node);
CREATE INDEX IF NOT EXISTS idx_knowledge_target ON knowledge_edges(target_node);

-- 4. Lab simulations (cache)
CREATE TABLE IF NOT EXISTS lab_simulations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formula_id      UUID REFERENCES formulas(id) ON DELETE CASCADE,
    ph              FLOAT,
    viscosity_cp    FLOAT,
    surface_tension FLOAT,
    stability_score INTEGER,
    shelf_life_days INTEGER,
    cost_per_kg     FLOAT,
    simulation_data JSONB,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 5. Substitution plans (cache)
CREATE TABLE IF NOT EXISTS substitution_plans (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_formula_id UUID REFERENCES formulas(id) ON DELETE CASCADE,
    target_level       VARCHAR(20) NOT NULL,
    region             VARCHAR(30) DEFAULT 'global',
    new_components     JSONB,
    cost_savings_percent FLOAT,
    quality_impact     TEXT,
    process_changes    JSONB DEFAULT '[]',
    stability_prediction TEXT,
    total_cost_per_kg  FLOAT,
    created_at         TIMESTAMP DEFAULT NOW()
);

-- 6. Safety reports
CREATE TABLE IF NOT EXISTS safety_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formula_id          UUID REFERENCES formulas(id) ON DELETE CASCADE,
    is_safe             BOOLEAN,
    overall_risk        VARCHAR(20),
    max_safe_temperature FLOAT,
    risks               JSONB,
    incompatible_pairs  JSONB,
    required_ppe        JSONB,
    storage_conditions  JSONB,
    pH_range            JSONB,
    flash_point_celsius FLOAT,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_formula ON safety_reports(formula_id);
CREATE INDEX IF NOT EXISTS idx_safety_risk ON safety_reports(overall_risk);
