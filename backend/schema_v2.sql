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
