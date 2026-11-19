# TruthLens Production Database & Storage Architecture

This directory contains the production database DDL schema and migration guides for **TruthLens** on **PostgreSQL / Supabase**.

---

## 1. Architecture Overview

TruthLens uses a hybrid persistence architecture engineered for high-throughput, multi-tenant media forensics:

1. **Production Database (Supabase PostgreSQL)**:
   - Relational persistence for registered forensic analysts and guest sessions.
   - Preserves complete investigation history, findings, and explainability telemetry across serverless restarts and multiple edge Lambdas.
   - Enforces multi-tenant data isolation via PostgreSQL **Row Level Security (RLS)**.

2. **Cloud Object Storage (Supabase Storage)**:
   - Stores binary forensic artifacts: Error Level Analysis (ELA) compression maps, neural face bounding box overlays, audio spectrograms, and downloadable PDF reports.
   - Bucket: `truthlens-forensic-artifacts`.
   - Served securely via Next.js artifact streaming endpoints (`/forensic-output/:filename` and `/api/artifacts/:filename`).

3. **Serverless Ephemeral Storage (`/tmp`)**:
   - Vercel and AWS Lambda deploy filesystems in read-only mode (`/var/task`).
   - All temporary media processing (FFmpeg demuxing, OpenCV frame extraction, PyDub acoustic slicing) is strictly confined to `os.tmpdir()/truthlens-forensics`.
   - Automatic stale file purging runs on upload cycles to prevent disk exhaustion.

4. **Zero-Config Local Fallback**:
   - When Supabase credentials are not supplied, TruthLens seamlessly operates using local in-memory caches and atomic JSON serialization under `/tmp`. Local tests and offline development run with 100% feature parity.

---

## 2. Relational Schema & Tables

The schema is defined in [`database/schema.sql`](./schema.sql).

| Table | Purpose | Primary Key | Key Indexes |
|---|---|---|---|
| `users` | Forensic analysts & registered investigators | `id` (`usr-...`) | `idx_users_email` |
| `sessions` | Cryptographically signed session tokens (30-day TTL) | `token` (hex) | `idx_sessions_user_id`, `idx_sessions_expires_at` |
| `investigations` | High-level media inspection records (supports user & guest isolation) | `id` (`inv-...`) | `idx_investigations_user_created`, `idx_investigations_media_type`, `idx_investigations_status`, `idx_investigations_report_id` |
| `analysis_findings` | Individual evidence items, heuristic indicators & model outputs | `id` (`ind-...`) | `idx_analysis_findings_investigation`, `idx_analysis_findings_severity`, `idx_analysis_findings_category` |
| `report_metadata` | Audit-trail metadata for generated PDF reports | `id` (`rep-...`) | `idx_report_metadata_investigation` |
| `analysis_outputs` | Full raw explainability telemetry JSON payload | `id` (`TL-...`) | `idx_analysis_outputs_investigation`, `idx_analysis_outputs_user` |

---

## 3. Row Level Security (RLS) & Multi-Tenancy

- **Registered Users vs. Guest Sessions**:
  - Registered users have identifiers formatted as `usr-<hex>`.
  - Guest sessions have identifiers formatted as `guest-<32-hex>`.
  - Investigations and findings are keyed by `user_id`. One guest cannot query or view another guest's investigations.
- **Service Role Access**:
  - The backend Next.js API uses the `SUPABASE_SERVICE_ROLE_KEY` to perform administrative operations, guest-to-user investigation transfers upon login/registration, and background analysis updates.
- **Guest-to-User Transfer**:
  - When an unauthenticated visitor runs analyses and later signs up or logs in, `investigationStore.transferGuestRecordsAsync(fromGuestUserId, toUserId)` atomically migrates ownership of all investigations and telemetry to the permanent account.

---

## 4. Setup & Deployment Instructions

### Step 1: Create a Supabase Project
1. Log in to [Supabase](https://supabase.com).
2. Create a new project (e.g. `truthlens-production`).
3. Note your **Project URL** and **API Keys** (`anon` public key and `service_role` secret key).

### Step 2: Apply the Database Schema
1. Open the Supabase Dashboard and navigate to the **SQL Editor**.
2. Copy the contents of [`database/schema.sql`](./schema.sql).
3. Paste into the SQL Editor and click **Run**.
4. Verify all 6 tables and the default lead analyst account are created:
   - Default user email: `analyst@truthlens.ai`
   - Default password: `TruthLens2026!`

### Step 3: Create the Storage Bucket
1. In the Supabase Dashboard, go to **Storage**.
2. Click **New Bucket**.
3. Name the bucket `truthlens-forensic-artifacts`.
4. Set it to **Public** (or configure appropriate download policies).
5. Click **Create Bucket**.

### Step 4: Configure Environment Variables
In your Vercel project settings or production environment:

```env
NEXT_PUBLIC_SUPABASE_URL=https://[YOUR-PROJECT-ID].supabase.co
SUPABASE_URL=https://[YOUR-PROJECT-ID].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[YOUR-SERVICE-ROLE-KEY]
SUPABASE_ANON_KEY=[YOUR-ANON-PUBLIC-KEY]
SUPABASE_STORAGE_BUCKET=truthlens-forensic-artifacts
```

---

## 5. Verification & Testing

Run the test suite to verify guest persistence and database synchronization:

```bash
# Test guest session isolation and history persistence
node test-guest-persistence.mjs

# Test end-to-end multi-modal analysis and PDF report generation
node test-complete-workflow.mjs
```
