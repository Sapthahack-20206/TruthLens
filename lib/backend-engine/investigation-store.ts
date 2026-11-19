import type { ForensicAnalysisOutput } from './types'

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

class InvestigationStore {
  private records: Map<string, InvestigationRecord> = new Map()
  private outputs: Map<string, ForensicAnalysisOutput> = new Map()

  constructor() {
    // Seed with initial baseline investigations so fresh workspaces have context
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
    this.records.set(record.id, record)
  }

  getRecord(id: string): InvestigationRecord | undefined {
    return this.records.get(id)
  }

  listRecords(): InvestigationRecord[] {
    return Array.from(this.records.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  saveOutput(output: ForensicAnalysisOutput) {
    this.outputs.set(output.id, output)
    if (output.investigationId) {
      this.outputs.set(output.investigationId, output)
    }
  }

  getOutput(id: string): ForensicAnalysisOutput | undefined {
    return this.outputs.get(id)
  }
}

// Global singleton instance
const globalStoreKey = Symbol.for('truthlens.investigationStore')
const globalObj = globalThis as unknown as { [key: symbol]: InvestigationStore }

if (!globalObj[globalStoreKey]) {
  globalObj[globalStoreKey] = new InvestigationStore()
}

export const investigationStore = globalObj[globalStoreKey]
