import fs from 'node:fs'
import path from 'node:path'
import type { ForensicAnalysisOutput } from './types'
import { validateIdParam } from './security-utils'

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

const DATA_DIR = path.join(process.cwd(), 'data')
const STORE_FILE = path.join(DATA_DIR, 'investigations_db.json')

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
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true })
      }
    } catch {
      // In-memory fallback
    }
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const raw = fs.readFileSync(STORE_FILE, 'utf-8')
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
      fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8')
    } catch {
      // In-memory fallback
    }
  }

  private seedBaselineSample() {
    const sampleId = 'inv-baseline-sample'
    const sampleReportId = 'rep-baseline-001'
    if (!this.records.has(sampleId)) {
      this.records.set(sampleId, {
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
      })
      this.persistToDisk()
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

    this.records.set(validId, { ...record, id: validId })
    this.persistToDisk()
  }

  getRecord(id: string, userId?: string): InvestigationRecord | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined

    let record = this.records.get(validId)
    if (!record) {
      record = Array.from(this.records.values()).find((r) => r.reportId === validId)
    }
    if (!record) return undefined

    // User access control:
    // If userId is provided, ensure record belongs to this user or is the default baseline sample
    if (userId) {
      if (record.id === 'inv-baseline-sample') {
        return record // Baseline sample is accessible for baseline verification
      }
      if (!record.userId || record.userId !== userId) {
        return undefined // Unauthorized access to another user's record
      }
    }

    return record
  }

  listRecords(userId?: string): InvestigationRecord[] {
    const all = Array.from(this.records.values())

    // If userId is provided, filter records by ownership
    const filtered = userId
      ? all.filter((r) => {
          // If the record was created by this user
          if (r.userId === userId) return true
          // If the record has no userId (legacy), allow for default analyst
          if (!r.userId && userId === 'usr-lead-analyst') return true
          // Baseline sample visible to lead analyst
          if (r.id === 'inv-baseline-sample' && userId === 'usr-lead-analyst') return true
          return false
        })
      : all

    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
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
  }

  getOutput(id: string, userId?: string): ForensicAnalysisOutput | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined

    let output = this.outputs.get(validId)
    if (!output) {
      output = Array.from(this.outputs.values()).find((o) => o.reportId === validId || o.investigationId === validId)
    }
    if (!output) return undefined

    // Check ownership if userId provided
    const outUser = (output as unknown as { userId?: string }).userId
    if (userId) {
      if (output.id === 'TL-BASELINE-SAMPLE') {
        return output
      }
      if (!outUser || outUser !== userId) {
        return undefined
      }
    }

    return output
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

    return transferred
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
