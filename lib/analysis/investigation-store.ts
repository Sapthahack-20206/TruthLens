import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { InvestigationRecord, ForensicResponse, AnalysisStatus } from './types'

export interface AnalysisTask {
  id: string
  status: AnalysisStatus
  mediaType: string
  filename: string
  createdAt: string
  completedAt?: string
  result?: ForensicResponse
  error?: string
}

const STORE_DIR = path.join(os.tmpdir(), 'truthlens_store')
const INVESTIGATIONS_FILE = path.join(STORE_DIR, 'investigations.json')
const RESULTS_FILE = path.join(STORE_DIR, 'results.json')
const TASKS_FILE = path.join(STORE_DIR, 'tasks.json')

// In-memory caches
const investigationsMap = new Map<string, InvestigationRecord>()
const resultsMap = new Map<string, ForensicResponse>()
const tasksMap = new Map<string, AnalysisTask>()

let isInitialized = false

async function initStore() {
  if (isInitialized) return
  isInitialized = true

  try {
    await fsp.mkdir(STORE_DIR, { recursive: true })

    if (fs.existsSync(INVESTIGATIONS_FILE)) {
      const data = await fsp.readFile(INVESTIGATIONS_FILE, 'utf-8')
      const records = JSON.parse(data) as InvestigationRecord[]
      for (const rec of records) investigationsMap.set(rec.id, rec)
    }

    if (fs.existsSync(RESULTS_FILE)) {
      const data = await fsp.readFile(RESULTS_FILE, 'utf-8')
      const records = JSON.parse(data) as ForensicResponse[]
      for (const rec of records) resultsMap.set(rec.id, rec)
    }

    if (fs.existsSync(TASKS_FILE)) {
      const data = await fsp.readFile(TASKS_FILE, 'utf-8')
      const records = JSON.parse(data) as AnalysisTask[]
      for (const rec of records) tasksMap.set(rec.id, rec)
    }
  } catch {
    // start with empty in-memory store
  }
}

async function persist() {
  try {
    await fsp.mkdir(STORE_DIR, { recursive: true })
    await fsp.writeFile(INVESTIGATIONS_FILE, JSON.stringify(Array.from(investigationsMap.values()), null, 2))
    await fsp.writeFile(RESULTS_FILE, JSON.stringify(Array.from(resultsMap.values()), null, 2))
    await fsp.writeFile(TASKS_FILE, JSON.stringify(Array.from(tasksMap.values()), null, 2))
  } catch {
    // Ignore persistence failure
  }
}

export async function saveInvestigation(record: InvestigationRecord): Promise<void> {
  await initStore()
  investigationsMap.set(record.id, record)
  await persist()
}

export async function listAllInvestigations(): Promise<InvestigationRecord[]> {
  await initStore()
  return Array.from(investigationsMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
}

export async function getInvestigationById(id: string): Promise<InvestigationRecord | null> {
  await initStore()
  return investigationsMap.get(id) || null
}

export async function saveForensicResponse(res: ForensicResponse): Promise<void> {
  await initStore()
  resultsMap.set(res.id, res)
  if (res.reportId) {
    resultsMap.set(res.reportId, res)
  }

  // Also update corresponding investigation record
  const existing = investigationsMap.get(res.investigationId)
  const requiresReview = (res.findings && res.findings.length > 0) || res.assessment.toLowerCase().includes('suspect')

  const record: InvestigationRecord = existing
    ? {
        ...existing,
        status: res.status,
        assessment: res.assessment,
        requiresReview,
        reportId: res.reportId
      }
    : {
        id: res.investigationId,
        filename: String(res.metadata.Filename || 'Investigation Evidence'),
        mediaType: res.mediaType,
        createdAt: res.createdAt,
        status: res.status,
        assessment: res.assessment,
        requiresReview,
        reportId: res.reportId
      }

  investigationsMap.set(record.id, record)
  await persist()
}

export async function getForensicResponseById(id: string): Promise<ForensicResponse | null> {
  await initStore()
  return resultsMap.get(id) || null
}

export async function createTask(id: string, filename: string, mediaType: string): Promise<AnalysisTask> {
  await initStore()
  const task: AnalysisTask = {
    id,
    filename,
    mediaType,
    status: 'processing',
    createdAt: new Date().toISOString()
  }
  tasksMap.set(id, task)
  await persist()
  return task
}

export async function updateTask(id: string, updates: Partial<AnalysisTask>): Promise<AnalysisTask | null> {
  await initStore()
  const task = tasksMap.get(id)
  if (!task) return null
  const updated = { ...task, ...updates }
  tasksMap.set(id, updated)
  await persist()
  return updated
}

export async function getTaskById(id: string): Promise<AnalysisTask | null> {
  await initStore()
  return tasksMap.get(id) || null
}
