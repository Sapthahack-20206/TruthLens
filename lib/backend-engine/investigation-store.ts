import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { ForensicAnalysisOutput } from './types'
import { validateIdParam } from './security-utils'
import { databaseService } from './database'
import { logger } from './logger'

export interface InvestigationRecord {
  id: string
  filename: string
  mediaType: 'image' | 'video' | 'audio' | 'text'
  createdAt: string
  status: string
  assessment?: string
  requiresReview?: boolean
  reportId?: string
  userId?: string
  fileSize?: number
  uncertaintyStatus?: string
  storageKey?: string
}

export interface UserInvestigationStats {
  total: number
  imageCount: number
  videoCount: number
  audioCount: number
  textCount: number
  requiresReviewCount: number
  cleanCount: number
}

const MAX_STORED_RECORDS = 500
const MAX_STORED_OUTPUTS = 200

// Safe temporary writable directory on all hosting environments (including Vercel)
const TEMP_DATA_DIR = path.join(os.tmpdir(), 'truthlens-forensics', 'data')
const TEMP_STORE_FILE = path.join(TEMP_DATA_DIR, 'investigations_db.json')
const LEGACY_STORE_FILE = path.join(process.cwd(), 'data', 'investigations_db.json')

class InvestigationStore {
  private records: Map<string, InvestigationRecord> = new Map()
  private outputs: Map<string, ForensicAnalysisOutput> = new Map()

  constructor() {
    this.ensureDataDir()
    this.loadFromDisk()
    this.seedBaselineSample()
  }

  private ensureDataDir() {
    try {
      if (!fs.existsSync(TEMP_DATA_DIR)) {
        fs.mkdirSync(TEMP_DATA_DIR, { recursive: true })
      }
    } catch {
      // In-memory fallback
    }
  }

  private loadFromDisk() {
    // 1. Try temp store file first (most up-to-date in current environment)
    let loaded = false
    try {
      if (fs.existsSync(TEMP_STORE_FILE)) {
        const raw = fs.readFileSync(TEMP_STORE_FILE, 'utf-8')
        this.parseAndHydrate(raw)
        loaded = true
      }
    } catch {
      // Continue to legacy check
    }

    // 2. If not in temp, check legacy workspace file
    if (!loaded) {
      try {
        if (fs.existsSync(LEGACY_STORE_FILE)) {
          const raw = fs.readFileSync(LEGACY_STORE_FILE, 'utf-8')
          this.parseAndHydrate(raw)
        }
      } catch {
        // In-memory fallback
      }
    }
  }

  private parseAndHydrate(raw: string) {
    try {
      const data = JSON.parse(raw) as {
        records?: InvestigationRecord[]
        outputs?: ForensicAnalysisOutput[]
      }

      if (Array.isArray(data.records)) {
        for (const rec of data.records) {
          if (rec && rec.id) this.records.set(rec.id, rec)
        }
      }
      if (Array.isArray(data.outputs)) {
        for (const out of data.outputs) {
          if (out && out.id) {
            this.outputs.set(out.id, out)
            if (out.investigationId) {
              this.outputs.set(out.investigationId, out)
            }
            if (out.reportId) {
              this.outputs.set(out.reportId, out)
            }
          }
        }
      }
    } catch {
      // In-memory fallback
    }
  }

  private persistToDisk() {
    try {
      this.ensureDataDir()
      const data = {
        records: Array.from(this.records.values()),
        outputs: Array.from(this.outputs.values()),
      }
      fs.writeFileSync(TEMP_STORE_FILE, JSON.stringify(data, null, 2), 'utf-8')

      // Also persist to legacy dir if writable in local dev
      try {
        const legacyDir = path.join(process.cwd(), 'data')
        if (fs.existsSync(legacyDir)) {
          fs.writeFileSync(LEGACY_STORE_FILE, JSON.stringify(data, null, 2), 'utf-8')
        }
      } catch {
        // Read-only serverless filesystem expected
      }
    } catch {
      // In-memory fallback
    }
  }

  private seedBaselineSample() {
    const sampleId = 'inv-baseline-sample'
    const sampleReportId = 'rep-baseline-001'
    if (!this.records.has(sampleId)) {
      const baselineRecord: InvestigationRecord = {
        id: sampleId,
        filename: 'gemini_generated_video_a5be6a4a.mp4',
        mediaType: 'video',
        createdAt: new Date().toISOString(),
        status: 'completed',
        assessment: 'Analysis completed. Heuristic indicators analyzed.',
        requiresReview: true,
        reportId: sampleReportId,
        userId: 'usr-lead-analyst',
        fileSize: 1048576,
        uncertaintyStatus: 'Requires Further Review',
      }
      this.records.set(sampleId, baselineRecord)
      this.persistToDisk()
      databaseService.saveInvestigation(baselineRecord).catch(() => {})
    }
  }

  saveRecord(record: InvestigationRecord) {
    const validId = validateIdParam(record.id)
    if (!validId) return

    // Evict oldest record if capacity is exceeded to avoid unbounded memory growth (DoS defense)
    if (this.records.size >= MAX_STORED_RECORDS) {
      const firstKey = this.records.keys().next().value
      if (firstKey) this.records.delete(firstKey)
    }

    const savedRecord = { ...record, id: validId }
    this.records.set(validId, savedRecord)
    this.persistToDisk()

    // Async sync to database
    databaseService.saveInvestigation(savedRecord).catch((err) => {
      logger.warn('Failed to asynchronously persist investigation to database', err)
    })
  }

  async saveRecordAsync(record: InvestigationRecord): Promise<void> {
    this.saveRecord(record)
    const persisted = await databaseService.saveInvestigation(record)
    if (!persisted && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PERSISTENCE_FALLBACK !== 'true') {
      logger.error(`Failed to persist investigation ${record.id} to Supabase in production environment.`)
      throw new Error(`Database persistence failure: unable to permanently store investigation ${record.id} in Supabase PostgreSQL.`)
    }
  }

  getRawRecord(id: string): InvestigationRecord | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined
    let record = this.records.get(validId)
    if (!record) {
      record = Array.from(this.records.values()).find((r) => r.reportId === validId)
    }
    return record
  }

  getRawOutput(id: string): ForensicAnalysisOutput | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined
    let output = this.outputs.get(validId)
    if (!output) {
      output = Array.from(this.outputs.values()).find((o) => o.reportId === validId || o.investigationId === validId)
    }
    return output
  }

  getRecord(id: string, userId?: string): InvestigationRecord | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined

    let record = this.records.get(validId)
    if (!record) {
      record = Array.from(this.records.values()).find((r) => r.reportId === validId)
    }
    if (!record) return undefined

    // Public baseline sample is viewable for demonstration
    if (record.id === 'inv-baseline-sample' || record.reportId === 'rep-baseline-001') {
      return record
    }

    // Strict user access control:
    // If the record has an owner, caller MUST provide a matching userId
    if (record.userId) {
      if (!userId || record.userId !== userId) {
        return undefined // Unauthorized access to another user's record
      }
    }

    return record
  }

  async getRecordAsync(id: string, userId?: string): Promise<InvestigationRecord | undefined> {
    const cached = this.getRecord(id, userId)
    if (cached) return cached

    const validId = validateIdParam(id)
    if (!validId) return undefined

    const dbRecord = await databaseService.getInvestigation(validId, userId)
    if (dbRecord) {
      this.records.set(dbRecord.id, dbRecord)
      return dbRecord
    }

    return undefined
  }

  listRecords(userId?: string): InvestigationRecord[] {
    const all = Array.from(this.records.values())

    // If userId is provided, filter records strictly by ownership
    const filtered = userId
      ? all.filter((r) => {
          if (r.userId === userId) return true
          if (r.id === 'inv-baseline-sample' && (userId === 'usr-lead-analyst' || userId.startsWith('guest-'))) return true
          return false
        })
      : all.filter((r) => r.id === 'inv-baseline-sample') // unauthenticated only sees baseline demo

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  async listRecordsAsync(userId?: string): Promise<InvestigationRecord[]> {
    const dbRecords = await databaseService.listInvestigations(userId)
    if (dbRecords && dbRecords.length > 0) {
      for (const rec of dbRecords) {
        this.records.set(rec.id, rec)
      }
      return dbRecords
    }
    return this.listRecords(userId)
  }

  saveOutput(output: ForensicAnalysisOutput, userId?: string) {
    const validId = validateIdParam(output.id)
    if (!validId) return

    // Evict oldest output if capacity exceeded
    if (this.outputs.size >= MAX_STORED_OUTPUTS) {
      const firstKey = this.outputs.keys().next().value
      if (firstKey) this.outputs.delete(firstKey)
    }

    const outputWithUser = userId ? { ...output, userId } : output
    this.outputs.set(validId, outputWithUser)
    if (output.investigationId) {
      const validInvId = validateIdParam(output.investigationId)
      if (validInvId) {
        this.outputs.set(validInvId, outputWithUser)
      }
    }
    if (output.reportId) {
      const validRepId = validateIdParam(output.reportId)
      if (validRepId) {
        this.outputs.set(validRepId, outputWithUser)
      }
    }
    this.persistToDisk()

    // Async sync to database
    databaseService.saveOutput(output, userId).catch((err) => {
      logger.warn('Failed to asynchronously persist analysis output to database', err)
    })
  }

  async saveOutputAsync(output: ForensicAnalysisOutput, userId?: string): Promise<void> {
    this.saveOutput(output, userId)
    const persisted = await databaseService.saveOutput(output, userId)
    if (!persisted && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_PERSISTENCE_FALLBACK !== 'true') {
      logger.error(`Failed to persist output ${output.id} to Supabase in production environment.`)
      throw new Error(`Database persistence failure: unable to permanently store analysis output ${output.id} in Supabase PostgreSQL.`)
    }
  }

  getOutput(id: string, userId?: string): ForensicAnalysisOutput | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined

    let output = this.outputs.get(validId)
    if (!output) {
      output = Array.from(this.outputs.values()).find((o) => o.reportId === validId || o.investigationId === validId)
    }
    if (!output) return undefined

    // Public baseline sample is viewable for demonstration
    if (output.id === 'TL-BASELINE-SAMPLE' || output.reportId === 'rep-baseline-001') {
      return output
    }

    // Strict ownership verification:
    const outUser = (output as unknown as { userId?: string }).userId
    if (outUser) {
      if (!userId || outUser !== userId) {
        return undefined // Unauthorized access to another user's output
      }
    }

    return output
  }

  async getOutputAsync(id: string, userId?: string): Promise<ForensicAnalysisOutput | undefined> {
    const cached = this.getOutput(id, userId)
    if (cached) return cached

    const validId = validateIdParam(id)
    if (!validId) return undefined

    const dbOutput = await databaseService.getOutput(validId, userId)
    if (dbOutput) {
      this.outputs.set(dbOutput.id, dbOutput)
      return dbOutput
    }

    return undefined
  }

  /**
   * Transfers all investigation records and analysis outputs from a guest session
   * to a newly authenticated or registered user account.
   */
  transferGuestRecords(fromGuestUserId: string, toUserId: string): number {
    if (!fromGuestUserId || !toUserId || fromGuestUserId === toUserId) return 0
    let transferred = 0

    for (const [key, record] of this.records.entries()) {
      if (record.userId === fromGuestUserId) {
        this.records.set(key, { ...record, userId: toUserId })
        transferred++
      }
    }

    for (const [key, output] of this.outputs.entries()) {
      const outUser = (output as unknown as { userId?: string }).userId
      if (outUser === fromGuestUserId) {
        this.outputs.set(key, { ...output, userId: toUserId } as ForensicAnalysisOutput)
      }
    }

    if (transferred > 0) {
      this.persistToDisk()
    }

    // Async sync transfer to database
    databaseService.transferGuestInvestigations(fromGuestUserId, toUserId).catch((err) => {
      logger.warn('Failed to asynchronously transfer guest records in database', err)
    })

    return transferred
  }

  async transferGuestRecordsAsync(fromGuestUserId: string, toUserId: string): Promise<number> {
    const localCount = this.transferGuestRecords(fromGuestUserId, toUserId)
    const dbCount = await databaseService.transferGuestInvestigations(fromGuestUserId, toUserId)
    return Math.max(localCount, dbCount)
  }

  getStats(userId?: string): UserInvestigationStats {
    const records = this.listRecords(userId)
    const total = records.length
    const imageCount = records.filter((r) => r.mediaType === 'image').length
    const videoCount = records.filter((r) => r.mediaType === 'video').length
    const audioCount = records.filter((r) => r.mediaType === 'audio').length
    const textCount = records.filter((r) => r.mediaType === 'text').length
    const requiresReviewCount = records.filter((r) => r.requiresReview === true).length
    const cleanCount = records.filter((r) => r.requiresReview === false).length

    return {
      total,
      imageCount,
      videoCount,
      audioCount,
      textCount,
      requiresReviewCount,
      cleanCount,
    }
  }
}

// Global singleton instance
const globalStoreKey = Symbol.for('truthlens.investigationStore')
const globalObj = globalThis as unknown as { [key: symbol]: InvestigationStore }

if (!globalObj[globalStoreKey]) {
  globalObj[globalStoreKey] = new InvestigationStore()
}

export const investigationStore = globalObj[globalStoreKey]
