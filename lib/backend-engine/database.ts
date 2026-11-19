import { createClient, SupabaseClient } from '@supabase/supabase-js'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { logger } from './logger'
import type { InvestigationRecord } from './investigation-store'
import type { ForensicAnalysisOutput } from './types'
import type { User, UserSession } from './auth-service'

// Environment variables for Supabase PostgreSQL
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ''

export const isDatabaseConfigured = (): boolean => {
  return Boolean(supabaseUrl && supabaseKey && supabaseUrl.startsWith('http'))
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
  private isConfigured: boolean

  constructor() {
    this.isConfigured = isDatabaseConfigured()
    if (this.isConfigured) {
      try {
        this.client = createClient(supabaseUrl, supabaseKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        })
        logger.info('DatabaseService initialized with Supabase PostgreSQL client')
      } catch (err) {
        logger.error('Failed to initialize Supabase client; falling back to local store', err)
        this.client = null
        this.isConfigured = false
      }
    } else {
      if (shouldFailWithoutDatabase()) {
        logger.error('CRITICAL: Supabase credentials (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are missing in production. Local persistence fallback is disabled.')
      } else {
        logger.info('Supabase credentials not detected; using resilient atomic local/temp storage')
      }
    }
    ensureTempDataDir()
  }

  getSupabase(): SupabaseClient | null {
    return this.client
  }

  isReady(): boolean {
    return this.isConfigured && this.client !== null
  }

  async ping(): Promise<{ connected: boolean; latencyMs?: number; error?: string }> {
    if (!this.client) {
      return { connected: false, error: 'Database client not configured' }
    }
    const start = Date.now()
    try {
      const { error } = await this.client.from('users').select('id').limit(1)
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
    if (this.client) {
      try {
        const { data, error } = await this.client
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
    if (this.client) {
      try {
        const { data, error } = await this.client
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

  async createUser(user: User): Promise<boolean> {
    if (this.client) {
      try {
        const { error } = await this.client.from('users').upsert({
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
          return false
        }
        return true
      } catch (err) {
        logger.error('Database createUser exception', err)
        return false
      }
    }
    if (shouldFailWithoutDatabase()) {
      logger.error('CRITICAL: Supabase database is required in production. Refusing fallback user creation.')
      return false
    }
    return true
  }

  // ============================================================================
  // SESSION OPERATIONS
  // ============================================================================

  async createSession(session: UserSession): Promise<boolean> {
    if (this.client) {
      try {
        const { error } = await this.client.from('sessions').insert({
          token: session.token,
          user_id: session.userId,
          created_at: session.createdAt,
          expires_at: session.expiresAt,
        })
        if (error) {
          logger.warn(`Supabase createSession error: ${error.message}`)
          return false
        }
        return true
      } catch (err) {
        logger.error('Database createSession exception', err)
        return false
      }
    }
    if (shouldFailWithoutDatabase()) {
      logger.error('CRITICAL: Supabase database is required in production. Refusing fallback session creation.')
      return false
    }
    return true
  }

  async findSession(token: string): Promise<UserSession | null> {
    if (this.client) {
      try {
        const { data, error } = await this.client
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
    if (this.client) {
      try {
        await this.client.from('sessions').delete().eq('token', token)
      } catch (err) {
        logger.error('Database deleteSession exception', err)
      }
    }
  }

  // ============================================================================
  // INVESTIGATION OPERATIONS
  // ============================================================================

  async saveInvestigation(record: InvestigationRecord): Promise<boolean> {
    if (this.client) {
      try {
        const uncertainty = record.uncertaintyStatus &&
          ['Potentially Manipulated', 'No Significant Indicators Detected', 'Requires Further Review'].includes(record.uncertaintyStatus)
            ? record.uncertaintyStatus
            : record.requiresReview ? 'Requires Further Review' : 'No Significant Indicators Detected'

        const { error } = await this.client.from('investigations').upsert({
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
    if (this.client) {
      try {
        let query = this.client
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
    if (this.client) {
      try {
        let query = this.client
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
    if (this.client) {
      try {
        // Transfer investigations
        const { data: invData, error: invError } = await this.client
          .from('investigations')
          .update({ user_id: toUserId })
          .eq('user_id', fromGuestUserId)
          .select('id')

        if (invError) {
          logger.error(`Supabase transferGuestInvestigations error: ${invError.message}`)
        }

        // Transfer analysis outputs
        const { error: outError } = await this.client
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
    if (this.client) {
      try {
        const effectiveUser = userId || (output as unknown as { userId?: string }).userId || 'usr-lead-analyst'
        const investigationId = output.investigationId || output.id

        // 1. Save telemetry JSON in analysis_outputs table
        const { error: outError } = await this.client.from('analysis_outputs').upsert({
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
            is_heuristic: Boolean(f.isHeuristic),
            model_name: f.modelName || null,
            timestamp_code: f.timestamp || null,
            evidence_ref: f.evidenceRef || null,
            human_review_recommendation: f.humanReviewRecommendation || null,
            created_at: output.createdAt || new Date().toISOString(),
          }))

          const { error: findingsError } = await this.client
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
    if (this.client) {
      try {
        let query = this.client
          .from('analysis_outputs')
          .select('payload, user_id')
          .or(`id.eq.${id},investigation_id.eq.${id},report_id.eq.${id}`)

        if (userId && id !== 'TL-BASELINE-SAMPLE') {
          query = query.eq('user_id', userId)
        }

        const { data, error } = await query.maybeSingle()
        if (error) {
          logger.warn(`Supabase getOutput error: ${error.message}`)
          return null
        }
        if (!data || !data.payload) return null

        return data.payload as ForensicAnalysisOutput
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
    summary?: string
    pdfStoragePath?: string
    checksumSha256?: string
    fileSizeBytes?: number
  }): Promise<boolean> {
    if (this.client) {
      try {
        const { error } = await this.client.from('report_metadata').upsert({
          id: report.id,
          investigation_id: report.investigationId,
          title: report.title,
          summary: report.summary || null,
          pdf_storage_path: report.pdfStoragePath || null,
          checksum_sha256: report.checksumSha256 || null,
          file_size_bytes: report.fileSizeBytes || 0,
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
