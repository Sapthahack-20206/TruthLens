import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { logger } from './logger'
import { resolveSupabaseUrl, resolveSupabaseKey } from './database'
import type { ForensicAnalysisOutput } from './types'
import type { InvestigationRecord, UserInvestigationStats } from './investigation-store'

export interface DbUser {
  id: string
  name: string
  email: string
  password_hash: string
  salt: string
  role: 'lead_analyst' | 'analyst' | 'investigator'
  created_at: string
}

export interface DbSession {
  token: string
  user_id: string
  created_at: string
  expires_at: string
}

export interface DbInvestigation {
  id: string
  user_id: string
  filename: string
  media_type: string
  file_size: number | null
  status: string
  assessment: string | null
  uncertainty_status: string | null
  requires_review: boolean
  report_id: string | null
  storage_key: string | null
  raw_output: ForensicAnalysisOutput | null
  created_at: string
  updated_at: string
}

export interface DbReportMetadata {
  id: string
  investigation_id: string
  user_id: string
  title: string
  summary: string | null
  pdf_storage_key: string | null
  created_at: string
}

class DatabaseManager {
  private client: SupabaseClient | null = null
  private isConfigured = false

  // In-memory fallback caches for offline dev & test isolation
  private memoryUsers = new Map<string, DbUser>()
  private memorySessions = new Map<string, DbSession>()
  private memoryInvestigations = new Map<string, DbInvestigation>()
  private memoryReports = new Map<string, DbReportMetadata>()

  constructor() {
    this.initClient()
  }

  private initClient() {
    const supabaseUrl = resolveSupabaseUrl()
    const supabaseKey = resolveSupabaseKey()

    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
      try {
        this.client = createClient(supabaseUrl, supabaseKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        })
        this.isConfigured = true
        logger.info('Database client successfully configured with Supabase.')
      } catch (err) {
        logger.warn('Failed to initialize Supabase client. Running in-memory database fallback.', err)
        this.client = null
        this.isConfigured = false
      }
    } else {
      logger.info('No external database credentials provided. Utilizing secure in-memory persistence store.')
      this.client = null
      this.isConfigured = false
    }
  }

  public get isConnected(): boolean {
    return this.isConfigured && this.client !== null
  }

  // ================= USERS =================
  async saveUser(user: DbUser): Promise<void> {
    this.memoryUsers.set(user.id, { ...user })

    if (this.client) {
      try {
        const { error } = await this.client.from('users').upsert({
          id: user.id,
          name: user.name,
          email: user.email,
          password_hash: user.password_hash,
          salt: user.salt,
          role: user.role,
          created_at: user.created_at,
        })
        if (error) {
          logger.warn(`Supabase upsert user error: ${error.message}`)
        }
      } catch (err) {
        logger.warn('Error saving user to Supabase', err)
      }
    }
  }

  async getUserByEmail(email: string): Promise<DbUser | null> {
    const normalized = email.trim().toLowerCase()

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('users')
          .select('*')
          .eq('email', normalized)
          .maybeSingle()

        if (!error && data) {
          return data as DbUser
        }
      } catch (err) {
        logger.warn('Supabase query getUserByEmail error', err)
      }
    }

    for (const u of this.memoryUsers.values()) {
      if (u.email.toLowerCase() === normalized) {
        return u
      }
    }
    return null
  }

  async getUserById(id: string): Promise<DbUser | null> {
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('users')
          .select('*')
          .eq('id', id)
          .maybeSingle()

        if (!error && data) {
          return data as DbUser
        }
      } catch (err) {
        logger.warn('Supabase query getUserById error', err)
      }
    }

    return this.memoryUsers.get(id) || null
  }

  // ================= SESSIONS =================
  async saveSession(session: DbSession): Promise<void> {
    this.memorySessions.set(session.token, { ...session })

    if (this.client) {
      try {
        const { error } = await this.client.from('sessions').upsert({
          token: session.token,
          user_id: session.user_id,
          created_at: session.created_at,
          expires_at: session.expires_at,
        })
        if (error) {
          logger.warn(`Supabase upsert session error: ${error.message}`)
        }
      } catch (err) {
        logger.warn('Error saving session to Supabase', err)
      }
    }
  }

  async getSession(token: string): Promise<DbSession | null> {
    const now = Date.now()

    if (this.client) {
      try {
        const { data, error } = await this.client
          .from('sessions')
          .select('*')
          .eq('token', token)
          .maybeSingle()

        if (!error && data) {
          if (new Date(data.expires_at).getTime() > now) {
            return data as DbSession
          }
          return null
        }
      } catch (err) {
        logger.warn('Supabase query getSession error', err)
      }
    }

    const sess = this.memorySessions.get(token)
    if (sess && new Date(sess.expires_at).getTime() > now) {
      return sess
    }
    return null
  }

  async deleteSession(token: string): Promise<void> {
    this.memorySessions.delete(token)

    if (this.client) {
      try {
        await this.client.from('sessions').delete().eq('token', token)
      } catch (err) {
        logger.warn('Supabase deleteSession error', err)
      }
    }
  }

  // ================= INVESTIGATIONS =================
  async saveInvestigation(inv: DbInvestigation): Promise<void> {
    this.memoryInvestigations.set(inv.id, { ...inv })

    if (this.client) {
      try {
        const { error } = await this.client.from('investigations').upsert({
          id: inv.id,
          user_id: inv.user_id,
          filename: inv.filename,
          media_type: inv.media_type,
          file_size: inv.file_size,
          status: inv.status,
          assessment: inv.assessment,
          uncertainty_status: inv.uncertainty_status,
          requires_review: inv.requires_review,
          report_id: inv.report_id,
          storage_key: inv.storage_key,
          raw_output: inv.raw_output,
          created_at: inv.created_at,
          updated_at: inv.updated_at,
        })
        if (error) {
          logger.warn(`Supabase upsert investigation error: ${error.message}`)
        }
      } catch (err) {
        logger.warn('Error saving investigation to Supabase', err)
      }
    }
  }

  async getInvestigation(id: string, userId?: string): Promise<DbInvestigation | null> {
    if (this.client) {
      try {
        let query = this.client
          .from('investigations')
          .select('*')
          .or(`id.eq.${id},report_id.eq.${id}`)

        if (userId) {
          query = query.or(`user_id.eq.${userId},id.eq.inv-baseline-sample`)
        }

        const { data, error } = await query.maybeSingle()
        if (!error && data) {
          return data as DbInvestigation
        }
      } catch (err) {
        logger.warn('Supabase query getInvestigation error', err)
      }
    }

    let found = this.memoryInvestigations.get(id)
    if (!found) {
      for (const item of this.memoryInvestigations.values()) {
        if (item.report_id === id) {
          found = item
          break
        }
      }
    }

    if (!found) return null

    // Enforce ownership check
    if (userId && found.user_id && found.user_id !== userId && found.id !== 'inv-baseline-sample') {
      return null
    }

    return found
  }

  async listInvestigations(userId?: string): Promise<DbInvestigation[]> {
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
        if (!error && Array.isArray(data)) {
          return data as DbInvestigation[]
        }
      } catch (err) {
        logger.warn('Supabase query listInvestigations error', err)
      }
    }

    const all = Array.from(this.memoryInvestigations.values())
    const filtered = userId
      ? all.filter((r) => r.user_id === userId || (r.id === 'inv-baseline-sample' && userId === 'usr-lead-analyst'))
      : all

    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  // ================= REPORT METADATA =================
  async saveReportMetadata(report: DbReportMetadata): Promise<void> {
    this.memoryReports.set(report.id, { ...report })

    if (this.client) {
      try {
        await this.client.from('report_metadata').upsert({
          id: report.id,
          investigation_id: report.investigation_id,
          user_id: report.user_id,
          title: report.title,
          summary: report.summary,
          pdf_storage_key: report.pdf_storage_key,
          created_at: report.created_at,
        })
      } catch (err) {
        logger.warn('Supabase saveReportMetadata error', err)
      }
    }
  }

  async getReportMetadata(reportId: string, userId?: string): Promise<DbReportMetadata | null> {
    if (this.client) {
      try {
        let query = this.client.from('report_metadata').select('*').eq('id', reportId)
        if (userId) {
          query = query.or(`user_id.eq.${userId},id.eq.rep-baseline-001`)
        }
        const { data, error } = await query.maybeSingle()
        if (!error && data) {
          return data as DbReportMetadata
        }
      } catch (err) {
        logger.warn('Supabase getReportMetadata error', err)
      }
    }

    const found = this.memoryReports.get(reportId)
    if (!found) return null

    if (userId && found.user_id && found.user_id !== userId && found.id !== 'rep-baseline-001') {
      return null
    }

    return found
  }
}

// Global Singleton instance
const globalDbKey = Symbol.for('truthlens.databaseManager')
const globalObj = globalThis as unknown as { [key: symbol]: DatabaseManager }

if (!globalObj[globalDbKey]) {
  globalObj[globalDbKey] = new DatabaseManager()
}

export const dbManager = globalObj[globalDbKey]
