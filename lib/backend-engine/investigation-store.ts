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
}

const MAX_STORED_RECORDS = 500
const MAX_STORED_OUTPUTS = 200

class InvestigationStore {
  private records: Map<string, InvestigationRecord> = new Map()
  private outputs: Map<string, ForensicAnalysisOutput> = new Map()

  constructor() {
    // Seed baseline sample record safely
    const sampleId = 'inv-baseline-sample'
    const sampleReportId = 'rep-baseline-001'
    this.records.set(sampleId, {
      id: sampleId,
      filename: 'gemini_generated_video_a5be6a4a.mp4',
      mediaType: 'video',
      createdAt: new Date().toISOString(),
      status: 'completed',
      assessment: 'Analysis completed. Heuristic indicators analyzed.',
      requiresReview: true,
      reportId: sampleReportId,
    })
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
  }

  getRecord(id: string): InvestigationRecord | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined
    return this.records.get(validId)
  }

  listRecords(): InvestigationRecord[] {
    return Array.from(this.records.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  saveOutput(output: ForensicAnalysisOutput) {
    const validId = validateIdParam(output.id)
    if (!validId) return

    // Evict oldest output if capacity exceeded
    if (this.outputs.size >= MAX_STORED_OUTPUTS) {
      const firstKey = this.outputs.keys().next().value
      if (firstKey) this.outputs.delete(firstKey)
    }

    this.outputs.set(validId, output)
    if (output.investigationId) {
      const validInvId = validateIdParam(output.investigationId)
      if (validInvId) {
        this.outputs.set(validInvId, output)
      }
    }
  }

  getOutput(id: string): ForensicAnalysisOutput | undefined {
    const validId = validateIdParam(id)
    if (!validId) return undefined
    return this.outputs.get(validId)
  }
}

// Global singleton instance
const globalStoreKey = Symbol.for('truthlens.investigationStore')
const globalObj = globalThis as unknown as { [key: symbol]: InvestigationStore }

if (!globalObj[globalStoreKey]) {
  globalObj[globalStoreKey] = new InvestigationStore()
}

export const investigationStore = globalObj[globalStoreKey]
