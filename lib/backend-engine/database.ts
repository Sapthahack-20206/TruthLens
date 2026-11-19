import { createClient, SupabaseClient } from '@supabase/supabase-js'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './logger'
import type { InvestigationRecord } from './investigation-store'
import type { ForensicAnalysisOutput } from './types'
import type { User, UserSession } from './auth-service'

/**
 * Normalizes any Supabase URL variant into the root HTTPS project origin
 * required by `@supabase/supabase-js` (e.g. `https://<project-ref>.supabase.co`).
 *
 * Strips:
 * 1. PostgREST/Auth/Storage API subpaths (e.g. `/rest/v1`, `/auth/v1`, `/storage/v1`, `/v1`)
 *    which `@supabase/supabase-js` automatically appends internally.
 * 2. Database wire ports (5432, 6543) mistakenly included in HTTP URLs.
 * 3. PostgreSQL connection strings (`postgresql://...`, `postgres://...`).
 * 4. `db.` database TCP host prefixes (converts `db.<ref>.supabase.co` to `<ref>.supabase.co`).
 * 5. Trailing slashes and query parameters.
 */
export function sanitizeSupabaseUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return ''
  let cleaned = rawUrl.trim()

  // 1. If it is a PostgreSQL connection string (e.g., from DATABASE_URL or POSTGRES_URL)
  if (cleaned.startsWith('postgres://') || cleaned.startsWith('postgresql://')) {
    // Check for postgres.[project-ref]:
    const poolerMatch = cleaned.match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9_-]+):/i)
    if (poolerMatch && poolerMatch[1]) {
      return `https://${poolerMatch[1]}.supabase.co`
    }
    // Check for @db.[project-ref].supabase.co or @[project-ref].supabase.co
    const hostMatch = cleaned.match(/@(?:db\.)?([a-z0-9_-]+)\.supabase\.co/i)
    if (hostMatch && hostMatch[1]) {
      return `https://${hostMatch[1]}.supabase.co`
    }
    return ''
  }

  // 2. Add https:// if protocol was omitted
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned
  }

  try {
    const parsed = new URL(cleaned)

    // Normalize db.<ref>.supabase.co -> <ref>.supabase.co
    const dbHostMatch = parsed.hostname.match(/^db\.([a-z0-9_-]+)\.supabase\.co$/i)
    if (dbHostMatch && dbHostMatch[1]) {
      parsed.hostname = `${dbHostMatch[1]}.supabase.co`
    }

    // Check pooler hostnames (e.g. aws-0-ap-northeast-1.pooler.supabase.com)
    if (parsed.hostname.includes('pooler.supabase.com')) {
      const userRefMatch = (parsed.username || '').match(/^postgres\.([a-z0-9_-]+)$/i)
      if (userRefMatch && userRefMatch[1]) {
        return `https://${userRefMatch[1]}.supabase.co`
      }
    }

    // Strip database wire ports: 5432 (Postgres), 6543 (PgBouncer)
    if (parsed.port === '5432' || parsed.port === '6543') {
      parsed.port = ''
    }

    // Strip PostgREST / GoTrue / Storage subpaths
    // Supabase JS client appends /rest/v1, /storage/v1, /auth/v1 automatically!
    let pathname = parsed.pathname || ''
    pathname = pathname.replace(/\/(rest|auth|storage)(\/v\d+)?\/?$/i, '')
    pathname = pathname.replace(/\/v\d+\/?$/i, '')
    pathname = pathname.replace(/\/+$/, '')

    parsed.pathname = pathname
    parsed.search = ''
    parsed.hash = ''

    const result = parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '')
    return result.replace(/\/+$/, '')
  } catch {
    return cleaned.replace(/\/(rest|auth|storage)(\/v\d+)?\/?$/i, '').replace(/\/+$/, '')
  }
}

/**
 * Dynamically resolves the Supabase project URL from multiple standard environment aliases.
 * Supports direct URLs and automatic project-ref extraction from database connection strings
 * (e.g., standard Vercel Supabase integration env vars like POSTGRES_URL / DATABASE_URL).
 */
export function resolveSupabaseUrl(): string {
  const candidateUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL ||
    ''
  ).trim()

  if (candidateUrl) {
    const sanitized = sanitizeSupabaseUrl(candidateUrl)
    if (sanitized && sanitized.startsWith('http')) {
      return sanitized
    }
  }

  // Derive project reference from connection strings if present
  const connectionString = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ''
  ).trim()

  if (connectionString) {
    const sanitized = sanitizeSupabaseUrl(connectionString)
    if (sanitized && sanitized.startsWith('http')) {
      return sanitized
    }
  }

  return ''
}

/**
 * Dynamically resolves the Supabase API / Service Role Key.
 * Checks service role keys first (for server-side privileged operations such as users / sessions),
 * then falls back to anon keys. Strips any extraneous quotes or surrounding whitespace.
 */
export function resolveSupabaseKey(): string {
  const rawKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_KEY ||
    ''
  ).trim()

  return rawKey.replace(/^['"]|['"]$/g, '').trim()
}

export const isDatabaseConfigured = (): boolean => {
  const url = resolveSupabaseUrl()
  const key = resolveSupabaseKey()
  return Boolean(url && key && url.startsWith('http'))
}

export const shouldFailWithoutDatabase = (): boolean => {
  return process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PERSISTENCE_FALLBACK !== 'true'
}

// Global fallback directory for local or temporary serverless persistence
const TEMP_DATA_DIR = path.join(os.tmpdir(), 'truthlens-forensics', 'data')

function ensureTempDataDir() {
  try {
    if (!fs.existsSync(TEMP_DATA_DIR)) {
      fs.mkdirSync(TEMP_DATA_DIR, { recursive: true })
    }
  } catch {
    // Read-only or concurrent creation fallback
  }
}

export class DatabaseService {
  private client: SupabaseClient | null = null
  private cachedUrl = ''
  private cachedKey = ''

  constructor() {
    this.ensureClient()
    ensureTempDataDir()
  }

  private ensureClient(): SupabaseClient | null {
    const currentUrl = resolveSupabaseUrl()
    const currentKey = resolveSupabaseKey()

    if (!currentUrl || !currentKey || !currentUrl.startsWith('http')) {
      this.client = null
      this.cachedUrl = ''
      this.cachedKey = ''
      return null
    }

    // Reuse existing client if credentials have not changed
    if (this.client && this.cachedUrl === currentUrl && this.cachedKey === currentKey) {
      return this.client
    }

    try {
      this.client = createClient(currentUrl, currentKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
      this.cachedUrl = currentUrl
      this.cachedKey = currentKey
      logger.info('DatabaseService initialized Supabase PostgreSQL client')
    } catch (err) {
      logger.error('Failed to initialize Supabase client; falling back to local store', err)
      this.client = null
      this.cachedUrl = ''
      this.cachedKey = ''
    }

    return this.client
  }

  getSupabase(): SupabaseClient | null {
    return this.ensureClient()
  }

  isReady(): boolean {
    return this.ensureClient() !== null
  }

  async ping(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
    const client = this.getSupabase()
    if (!client) {
      const url = resolveSupabaseUrl()
      const key = resolveSupabaseKey()
      const missing: string[] = []
      if (!url) missing.push('SUPABASE_URL')
      if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY')
      return {
        connected: false,
        error: `Database client not configured (missing ${missing.join(' and ') || 'environment credentials'})`,
      }
    }

    const start = Date.now()
    try {
      const { error } = await client.from('users').select('id').limit(1)
      if (error) {
        return { connected: false, error: error.message }
      }
      return { connected: true, latencyMs: Date.now() - start }
    } catch (err) {
      return { connected: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  async findUserByEmail(email: string): Promise<User | null> {
    const cleanEmail = email.trim().toLowerCase()
    const client = this.getSupabase()
    if (client) {
      try {
        const { data, error } = await client
          .from('users')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle()

        if (error) {
          logger.warn(`Supabase findUserByEmail error: ${error.message}`)
          return null
        }
        if (!data) return null

        return {
          id: data.id,
          name: data.name,
          email: data.email,
          passwordHash: data.password_hash,
          salt: data.salt,
          role: data.role,
          createdAt: data.created_at,
        }
      } catch (err) {
        logger.error('Database findUserByEmail exception', err)
      }
    }
    return null
  }

  async findUserById(id: string): Promise<User | null> {
    const client = this.getSupabase()
    if (client) {
      try {
        const { data, error } = await client
          .from('users')
          .select('*')
          .eq('id', id)
          .maybeSingle()

        if (error) {
          logger.warn(`Supabase findUserById error: ${error.message}`)
          return null
        }
        if (!data) return null

        return {
          id: data.id,
          name: data.name,
          email: data.email,
          passwordHash: data.password_hash,
          salt: data.salt,
          role: data.role,
          createdAt: data.created_at,
        }
      } catch (err) {
        logger.error('Database findUserById exception', err)
      }
    }
    return null
  }

  async createUser(user: User): Promise<{ success: boolean; error?: string }> {
    const client = this.getSupabase()
    if (client) {
      try {
        const { error } = await client.from('users').upsert({
          id: user.id,
          name: user.name,
          email: user.email.toLowerCase(),
          password_hash: user.passwordHash,
          salt: user.salt,
          role: user.role,
          created_at: user.createdAt,
        })
        if (error) {
          logger.error(`Supabase createUser error: ${error.message}`)
          return { success: false, error: error.message }
        }
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Database createUser exception', err)
        return { success: false, error: msg }
      }
    }
    if (shouldFailWithoutDatabase()) {
      const msg = 'CRITICAL: Supabase database is required in production. Database client not configured (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).'
      logger.error(msg)
      return { success: false, error: msg }
    }
    return { success: true }
  }

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  async createSession(session: UserSession): Promise<{ success: boolean; error?: string }> {
    const client = this.getSupabase()
    if (client) {
      try {
        const { error } = await client.from('sessions').upsert({
          token: session.token,
          user_id: session.userId,
          created_at: session.createdAt,
          expires_at: session.expiresAt,
        }, { onConflict: 'token' })
        if (error) {
          logger.warn(`Supabase createSession error: ${error.message}`)
          return { success: false, error: error.message }
        }
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Database createSession exception', err)
        return { success: false, error: msg }
      }
    }
    if (shouldFailWithoutDatabase()) {
      const msg = 'CRITICAL: Supabase database is required in production. Database client not configured.'
      logger.error(msg)
      return { success: false, error: msg }
    }
    return { success: true }
  }

  async findSession(token: string): Promise<UserSession | null> {
    const client = this.getSupabase()
    if (client) {
      try {
        const { data, error } = await client
          .from('sessions')
          .select('*')
          .eq('token', token)
          .maybeSingle()

        if (error) {
          logger.warn(`Supabase findSession error: ${error.message}`)
          return null
        }
        if (!data) return null

        // Check expiration
        if (new Date(data.expires_at).getTime() <= Date.now()) {
          await this.deleteSession(token)
          return null
        }

        return {
          token: data.token,
          userId: data.user_id,
          createdAt: data.created_at,
          expiresAt: data.expires_at,
        }
      } catch (err) {
        logger.error('Database findSession exception', err)
      }
    }
    return null
  }

  async deleteSession(token: string): Promise<void> {
    const client = this.getSupabase()
    if (client) {
      try {
        await client.from('sessions').delete().eq('token', token)
      } catch (err) {
        logger.error('Database deleteSession exception', err)
      }
    }
  }

  // ============================================================================
  // INVESTIGATION OPERATIONS
  // ============================================================================

  async saveInvestigation(record: InvestigationRecord): Promise<boolean> {
    const client = this.getSupabase()
    if (client) {
      try {
        let uncertainty: 'Potentially Manipulated' | 'No Significant Indicators Detected' | 'Requires Further Review' = 'Requires Further Review'
        if (
          record.uncertaintyStatus === 'Likely AI-Generated' ||
          record.uncertaintyStatus === 'Likely Manipulated' ||
          record.uncertaintyStatus === 'Likely AI-Generated Audio' ||
          record.uncertaintyStatus === 'Likely Manipulated Audio' ||
          record.uncertaintyStatus === 'Potentially Manipulated'
        ) {
          uncertainty = 'Potentially Manipulated'
        } else if (record.uncertaintyStatus === 'No Significant Indicators Detected') {
          uncertainty = 'No Significant Indicators Detected'
        } else if (record.uncertaintyStatus === 'Inconclusive' || record.uncertaintyStatus === 'Requires Further Review') {
          uncertainty = 'Requires Further Review'
        } else {
          uncertainty = record.requiresReview ? 'Requires Further Review' : 'No Significant Indicators Detected'
        }

        const { error } = await client.from('investigations').upsert({
          id: record.id,
          user_id: record.userId || 'usr-lead-analyst',
          filename: record.filename,
          media_type: record.mediaType,
          file_size: record.fileSize || 0,
          status: record.status || 'completed',
          assessment: record.assessment || null,
          uncertainty_status: uncertainty,
          requires_review: Boolean(record.requiresReview),
          report_id: record.reportId || null,
          created_at: record.createdAt,
        })

        if (error) {
          logger.error(`Supabase saveInvestigation error: ${error.message}`)
          return false
        }
        return true
      } catch (err) {
        logger.error('Database saveInvestigation exception', err)
        return false
      }
    }
    if (shouldFailWithoutDatabase()) {
      logger.error('CRITICAL: Supabase database is required in production. Refusing fallback investigation storage.')
      return false
    }
    return true
  }

  async getInvestigation(id: string, userId?: string): Promise<InvestigationRecord | null> {
    const client = this.getSupabase()
    if (client) {
      try {
        let query = client
          .from('investigations')
          .select('*')
          .or(`id.eq.${id},report_id.eq.${id}`)

        if (userId && id !== 'inv-baseline-sample') {
          query = query.eq('user_id', userId)
        }

        const { data, error } = await query.maybeSingle()
        if (error) {
          logger.warn(`Supabase getInvestigation error: ${error.message}`)
          return null
        }
        if (!data) return null

        return {
          id: data.id,
          filename: data.filename,
          mediaType: data.media_type,
          createdAt: data.created_at,
          status: data.status,
          assessment: data.assessment || undefined,
          requiresReview: data.requires_review,
          reportId: data.report_id || undefined,
          userId: data.user_id,
          fileSize: data.file_size || undefined,
          uncertaintyStatus: data.uncertainty_status,
        }
      } catch (err) {
        logger.error('Database getInvestigation exception', err)
      }
    }
    return null
  }

  async listInvestigations(userId?: string): Promise<InvestigationRecord[]> {
    const client = this.getSupabase()
    if (client) {
      try {
        let query = client
          .from('investigations')
          .select('*')
          .order('created_at', { ascending: false })

        if (userId) {
          query = query.or(`user_id.eq.${userId},id.eq.inv-baseline-sample`)
        }

        const { data, error } = await query
        if (error) {
          logger.warn(`Supabase listInvestigations error: ${error.message}`)
          return []
        }
        if (!data) return []

        return data.map((d) => ({
          id: d.id,
          filename: d.filename,
          mediaType: d.media_type,
          createdAt: d.created_at,
          status: d.status,
          assessment: d.assessment || undefined,
          requiresReview: d.requires_review,
          reportId: d.report_id || undefined,
          userId: d.user_id,
          fileSize: d.file_size || undefined,
          uncertaintyStatus: d.uncertainty_status,
        }))
      } catch (err) {
        logger.error('Database listInvestigations exception', err)
      }
    }
    return []
  }

  async transferGuestInvestigations(fromGuestUserId: string, toUserId: string): Promise<number> {
    if (!fromGuestUserId || !toUserId || fromGuestUserId === toUserId) return 0
    const client = this.getSupabase()
    if (client) {
      try {
        // Transfer investigations
        const { data: invData, error: invError } = await client
          .from('investigations')
          .update({ user_id: toUserId })
          .eq('user_id', fromGuestUserId)
          .select('id')

        if (invError) {
          logger.error(`Supabase transferGuestInvestigations error: ${invError.message}`)
        }

        // Transfer analysis outputs
        const { error: outError } = await client
          .from('analysis_outputs')
          .update({ user_id: toUserId })
          .eq('user_id', fromGuestUserId)

        if (outError) {
          logger.warn(`Supabase transfer analysis_outputs error: ${outError.message}`)
        }

        return invData ? invData.length : 0
      } catch (err) {
        logger.error('Database transferGuestInvestigations exception', err)
      }
    }
    return 0
  }

  // ============================================================================
  // ANALYSIS OUTPUTS & FINDINGS OPERATIONS
  // ============================================================================

  async saveOutput(output: ForensicAnalysisOutput, userId?: string): Promise<boolean> {
    const client = this.getSupabase()
    if (client) {
      try {
        const effectiveUser = userId || (output as unknown as { userId?: string }).userId || 'usr-lead-analyst'
        const investigationId = output.investigationId || output.id

        // 1. Save telemetry JSON in analysis_outputs table
        const { error: outError } = await client.from('analysis_outputs').upsert({
          id: output.id,
          investigation_id: investigationId,
          report_id: output.reportId || null,
          user_id: effectiveUser,
          payload: output,
          created_at: output.createdAt || new Date().toISOString(),
        })

        if (outError) {
          logger.warn(`Supabase saveOutput error: ${outError.message}`)
        }

        // 2. Persist individual findings in analysis_findings table for relational queries
        if (Array.isArray(output.findings) && output.findings.length > 0) {
          const rows = output.findings.map((f, idx) => ({
            id: f.id || `${output.id}-f-${idx}`,
            investigation_id: investigationId,
            category: f.category || 'image',
            type: f.type || 'Indicator',
            title: f.title || 'Forensic Finding',
            description: f.description || '',
            severity: ['critical', 'high', 'moderate', 'low', 'info'].includes(f.severity) ? f.severity : 'info',
            confidence: typeof f.confidence === 'number' ? Math.round(f.confidence * 100) / 100 : null,
            timestamp: f.timestamp || null,
            frame_number: typeof f.frameNumber === 'number' ? f.frameNumber : null,
            is_heuristic: Boolean(f.isHeuristic),
            human_review_recommendation: f.humanReviewRecommendation || null,
            raw_data: {
              evidenceRef: f.evidenceRef || null,
              modelName: f.modelName || null,
            },
            created_at: output.createdAt || new Date().toISOString(),
          }))

          const { error: findingsError } = await client
            .from('analysis_findings')
            .upsert(rows, { onConflict: 'id' })

          if (findingsError) {
            logger.warn(`Supabase saveFindings error: ${findingsError.message}`)
          }
        }

        return true
      } catch (err) {
        logger.error('Database saveOutput exception', err)
        return false
      }
    }
    if (shouldFailWithoutDatabase()) {
      logger.error('CRITICAL: Supabase database is required in production. Refusing fallback output storage.')
      return false
    }
    return true
  }

  async getOutput(id: string, userId?: string): Promise<ForensicAnalysisOutput | null> {
    const client = this.getSupabase()
    if (client) {
      try {
        let query = client
          .from('analysis_outputs')
          .select('payload')
          .or(`id.eq.${id},investigation_id.eq.${id},report_id.eq.${id}`)

        if (userId && id !== 'inv-baseline-sample') {
          query = query.eq('user_id', userId)
        }

        const { data, error } = await query.maybeSingle()
        if (error) {
          logger.warn(`Supabase getOutput error: ${error.message}`)
          return null
        }
        if (data?.payload) {
          return data.payload as ForensicAnalysisOutput
        }
      } catch (err) {
        logger.error('Database getOutput exception', err)
      }
    }
    return null
  }

  // ============================================================================
  // REPORT METADATA OPERATIONS
  // ============================================================================

  async saveReportMetadata(report: {
    id: string
    investigationId: string
    title: string
    userId?: string
    summary?: string
    pdfStoragePath?: string
    checksumSha256?: string
    fileSizeBytes?: number
  }): Promise<boolean> {
    const client = this.getSupabase()
    if (client) {
      try {
        const { error } = await client.from('report_metadata').upsert({
          id: report.id,
          investigation_id: report.investigationId,
          user_id: report.userId || 'usr-lead-analyst',
          title: report.title,
          summary: report.summary || null,
          pdf_storage_key: report.pdfStoragePath || null,
          created_at: new Date().toISOString(),
        })

        if (error) {
          logger.warn(`Supabase saveReportMetadata error: ${error.message}`)
          return false
        }
        return true
      } catch (err) {
        logger.error('Database saveReportMetadata exception', err)
        return false
      }
    }
    if (shouldFailWithoutDatabase()) {
      logger.error('CRITICAL: Supabase database is required in production. Refusing fallback report metadata storage.')
      return false
    }
    return true
  }
}

// Global Singleton Instance
const globalDbKey = Symbol.for('truthlens.databaseService')
const globalObj = globalThis as unknown as { [key: symbol]: DatabaseService }

if (!globalObj[globalDbKey]) {
  globalObj[globalDbKey] = new DatabaseService()
}

export const databaseService = globalObj[globalDbKey]
