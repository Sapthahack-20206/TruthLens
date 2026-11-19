-- ==============================================================================
-- TRUTHLENS PRODUCTION DATABASE SCHEMA (POSTGRESQL / SUPABASE)
-- Version: 1.0.0
-- Architecture: Multi-tenant, guest-isolated digital media forensics platform
-- ==============================================================================

-- Enable UUID and cryptographic extensions if not already present
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. USERS TABLE
-- Stores registered forensic analysts and investigators
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'analyst' CHECK (role IN ('lead_analyst', 'analyst', 'investigator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for instant email credential lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ------------------------------------------------------------------------------
-- 2. SESSIONS TABLE
-- Authenticated analyst session tokens with cryptographic TTL
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT
);

-- Indexes for session authentication checks and garbage collection
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- ------------------------------------------------------------------------------
-- 3. INVESTIGATIONS TABLE
-- High-level examination records supporting both registered analysts & guest sessions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigations (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL, -- Format: 'usr-...' for accounts, 'guest-...' for guests
    filename VARCHAR(255) NOT NULL,
    media_type VARCHAR(32) NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'text', 'multimodal')),
    file_size BIGINT DEFAULT 0,
    file_hash_sha256 VARCHAR(64),
    storage_path TEXT, -- Cloud object storage URL (e.g. Supabase Storage / S3)
    status VARCHAR(32) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    assessment TEXT,
    uncertainty_status VARCHAR(64) NOT NULL DEFAULT 'Requires Further Review'
        CHECK (uncertainty_status IN ('Potentially Manipulated', 'No Significant Indicators Detected', 'Requires Further Review')),
    requires_review BOOLEAN NOT NULL DEFAULT true,
    report_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- High-performance composite indexes for user history lists, filters, and searches
CREATE INDEX IF NOT EXISTS idx_investigations_user_created ON investigations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_media_type ON investigations(media_type);
CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status);
CREATE INDEX IF NOT EXISTS idx_investigations_report_id ON investigations(report_id);

-- ------------------------------------------------------------------------------
-- 4. ANALYSIS FINDINGS TABLE
-- Individual evidence points, neural model outputs, and heuristic indicators
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_findings (
    id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    category VARCHAR(32) NOT NULL CHECK (category IN ('video', 'audio', 'image', 'transcript', 'cross-modal', 'metadata')),
    type VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(16) NOT NULL DEFAULT 'info' CHECK (severity IN ('critical', 'high', 'moderate', 'low', 'info')),
    confidence NUMERIC(5, 2), -- 0.00 to 100.00 (NULL when heuristic / not calculated)
    is_heuristic BOOLEAN NOT NULL DEFAULT true,
    model_name VARCHAR(128),
    timestamp_code VARCHAR(32),
    timestamp_seconds NUMERIC(10, 3),
    evidence_ref VARCHAR(255),
    human_review_recommendation TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for rapid retrieval of findings by parent investigation
CREATE INDEX IF NOT EXISTS idx_analysis_findings_investigation ON analysis_findings(investigation_id);
CREATE INDEX IF NOT EXISTS idx_analysis_findings_severity ON analysis_findings(severity);
CREATE INDEX IF NOT EXISTS idx_analysis_findings_category ON analysis_findings(category);

-- ------------------------------------------------------------------------------
-- 5. REPORT METADATA TABLE
-- Audit-trail report documents generated for legal or institutional review
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_metadata (
    id VARCHAR(64) PRIMARY KEY, -- Format: 'rep-...'
    investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    pdf_storage_path TEXT, -- Supabase Storage object key / public URL
    checksum_sha256 VARCHAR(64),
    file_size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_metadata_investigation ON report_metadata(investigation_id);

-- ------------------------------------------------------------------------------
-- 6. ANALYSIS OUTPUTS TABLE (RAW TELEMETRY PAYLOAD)
-- Stores full explainability telemetry JSON for instant detail rendering
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analysis_outputs (
    id VARCHAR(64) PRIMARY KEY, -- Format: 'TL-...'
    investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    report_id VARCHAR(64),
    user_id VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analysis_outputs_investigation ON analysis_outputs(investigation_id);
CREATE INDEX IF NOT EXISTS idx_analysis_outputs_user ON analysis_outputs(user_id);

-- ------------------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures complete multi-tenant isolation and user ownership
-- ------------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_outputs ENABLE ROW LEVEL SECURITY;

-- Service Role Key retains full administrative access for backend API operations
CREATE POLICY "Service Role Full Access Users" ON users
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Service Role Full Access Sessions" ON sessions
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Service Role Full Access Investigations" ON investigations
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Service Role Full Access Findings" ON analysis_findings
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Service Role Full Access Reports" ON report_metadata
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Service Role Full Access Outputs" ON analysis_outputs
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

-- ------------------------------------------------------------------------------
-- SEED DEFAULT LEAD ANALYST
-- Seed default lead analyst account (Password: TruthLens2026!)
-- ------------------------------------------------------------------------------
INSERT INTO users (id, name, email, password_hash, salt, role)
VALUES (
    'usr-lead-analyst',
    'Lead Forensic Analyst',
    'analyst@truthlens.ai',
    -- Scrypt hash for 'TruthLens2026!' with salt 'c8172df3b036f011925b393bce30b050'
    '34812a1f11a4369e54d68e57861ce1922c19e530089e02e6522c1d355aa7968dc2684fe18d7ee23ee18bf7523fdf5349e49c71676997d620573c051a82f3efc9',
    'c8172df3b036f011925b393bce30b050',
    'lead_analyst'
) ON CONFLICT (email) DO NOTHING;
