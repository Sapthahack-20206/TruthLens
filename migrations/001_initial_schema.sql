-- TruthLens Production Database Schema Migration
-- Migration: 001_initial_schema.sql
-- Description: Creates core forensic persistence tables for users, sessions, investigations, analysis findings, and reports.

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'analyst',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 3. Investigations Table
CREATE TABLE IF NOT EXISTS investigations (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    filename TEXT NOT NULL,
    media_type VARCHAR(32) NOT NULL,
    file_size BIGINT,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    assessment TEXT,
    uncertainty_status VARCHAR(64),
    requires_review BOOLEAN DEFAULT FALSE,
    report_id VARCHAR(64) UNIQUE,
    storage_key TEXT,
    raw_output JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Analysis Findings Table
CREATE TABLE IF NOT EXISTS analysis_findings (
    id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    category VARCHAR(32) NOT NULL,
    type VARCHAR(128),
    title TEXT NOT NULL,
    description TEXT,
    severity VARCHAR(32) NOT NULL DEFAULT 'low',
    confidence NUMERIC(5,2),
    timestamp VARCHAR(32),
    frame_number INT,
    is_heuristic BOOLEAN DEFAULT TRUE,
    human_review_recommendation TEXT,
    raw_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Report Metadata Table
CREATE TABLE IF NOT EXISTS report_metadata (
    id VARCHAR(64) PRIMARY KEY,
    investigation_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    user_id VARCHAR(128) NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    pdf_storage_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance & Query B-Tree Indexes
CREATE INDEX IF NOT EXISTS idx_investigations_user_created ON investigations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_report_id ON investigations(report_id);
CREATE INDEX IF NOT EXISTS idx_findings_investigation ON analysis_findings(investigation_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON report_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_investigation ON report_metadata(investigation_id);

-- Optional Row-Level Security (RLS) Enablement for Supabase PostgreSQL
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_metadata ENABLE ROW LEVEL SECURITY;

-- Service Role Policies (Allows server-side backend engine full access)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_users') THEN
        CREATE POLICY service_role_all_users ON users FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_sessions') THEN
        CREATE POLICY service_role_all_sessions ON sessions FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_investigations') THEN
        CREATE POLICY service_role_all_investigations ON investigations FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_findings') THEN
        CREATE POLICY service_role_all_findings ON analysis_findings FOR ALL USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_all_reports') THEN
        CREATE POLICY service_role_all_reports ON report_metadata FOR ALL USING (true);
    END IF;
END $$;
