const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '')

export type InvestigationResponse = {
  id: string
  status?: string
}

export type InvestigationRecord = {
  id: string
  filename: string
  mediaType: 'image' | 'video' | 'audio' | 'text'
  createdAt: string
  status: string
  assessment?: string
  requiresReview?: boolean
  reportId?: string
}

export type ForensicFinding = {
  id?: string
  category?: 'video' | 'audio' | 'image' | 'transcript' | 'cross-modal'
  type?: string
  title?: string
  description?: string
  timestamp?: string
  evidenceRef?: string
  sourceRef?: string
  confidence?: number | string
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  isHeuristic?: boolean
  modelName?: string
  humanReviewRecommendation?: string
}

export type VideoForensicFrame = {
  frameNumber: number
  seconds: number
  timestamp: string
  isSuspicious: boolean
  anomalyCount: number
  faceDetected: boolean
  faceBoundingBox?: { x: number; y: number; width: number; height: number }
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  indicators: string[]
  previewThumbnail?: string
}

export type ForensicResponse = {
  id?: string
  investigationId?: string
  reportId?: string
  status?: string
  assessment?: string
  uncertaintyStatus?: 'Potentially Manipulated' | 'No Significant Indicators Detected' | 'Requires Further Review'
  summary?: string
  metadata?: Record<string, string | number | boolean | null>
  findings?: ForensicFinding[]
  suspiciousTimestamps?: {
    timestamp: string
    seconds?: number
    frameNumber?: number
    label?: string
    description?: string
    evidenceRef?: string
    severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
    anomalyType?: string
    metricValue?: string
    isHeuristic?: boolean
    faceDetected?: boolean
    faceBoundingBox?: { x: number; y: number; width: number; height: number }
    previewThumbnail?: string
  }[]
  suspiciousRegions?: { id: string; box: [number, number, number, number]; deepfakeProbability: number; label: string; description: string; confidence: number }[]
  evidenceRelationships?: { source: string; target: string; relationship: string; explanation?: string }[]
  visualizations?: { label: string; url: string }[]
  limitations?: string[]
  processingErrors?: string[]
  videoTimeline?: VideoForensicFrame[]
  videoMetrics?: {
    totalFramesSampled: number
    facesDetectedCount: number
    averageInterframeDiff: number
    compressionVariance: number
  }
}

function formatApiError(detail: string, contentType: string | null, fallback: string) {
  if (contentType?.includes('application/json')) {
    try {
      const payload = JSON.parse(detail) as { detail?: unknown; message?: unknown; error?: unknown }
      const message = [payload.detail, payload.message, payload.error].find((value): value is string => typeof value === 'string')
      if (message) return message
    } catch {
      return fallback
    }
  }

  if (contentType?.startsWith('text/plain') && detail.trim().length > 0 && detail.trim().length <= 280) return detail.trim()
  return fallback
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, init)
  } catch {
    throw new Error('The analysis service is unavailable. Connect the FastAPI backend and try again.')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(formatApiError(detail, response.headers.get('content-type'), `The analysis service returned ${response.status}. No result was generated.`))
  }

  return response.json() as Promise<T>
}

function upload<T>(path: string, body: FormData, onProgress?: (percentage: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    xhr.responseType = 'text'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () => reject(new Error('The analysis service is unavailable. Connect the FastAPI backend and try again.'))
    xhr.onabort = () => reject(new Error('The upload was cancelled. No result was generated.'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(formatApiError(xhr.responseText, xhr.getResponseHeader('content-type'), `The analysis service returned ${xhr.status}. No result was generated.`)))
        return
      }
      try {
        resolve(JSON.parse(xhr.responseText) as T)
      } catch {
        reject(new Error('The analysis service returned an unreadable response. No result was generated.'))
      }
    }
    xhr.send(body)
  })
}

function appendContext(body: FormData, context: string) {
  if (context.trim()) body.append('context', context.trim())
  return body
}

export function createInvestigation(files: File[], context = '', onProgress?: (percentage: number) => void) {
  const body = new FormData()
  for (const file of files) body.append('files', file)
  return upload<InvestigationResponse>('/api/investigations', appendContext(body, context), onProgress)
}

export function analyzeImage(file: File, context = '', onProgress?: (percentage: number) => void) {
  const body = new FormData()
  body.append('file', file)
  return upload<ForensicResponse>('/api/analyze/image', appendContext(body, context), onProgress)
}

export function analyzeVideo(file: File, context = '', onProgress?: (percentage: number) => void) {
  const body = new FormData()
  body.append('file', file)
  return upload<ForensicResponse>('/api/analyze/video', appendContext(body, context), onProgress)
}

export function analyzeAudio(file: File, context = '', onProgress?: (percentage: number) => void) {
  const body = new FormData()
  body.append('file', file)
  return upload<ForensicResponse>('/api/analyze/audio', appendContext(body, context), onProgress)
}

export function analyzeCrossModal(files: File[], context = '', onProgress?: (percentage: number) => void) {
  const body = new FormData()
  for (const file of files) body.append('files', file)
  return upload<ForensicResponse>('/api/analyze/cross-modal', appendContext(body, context), onProgress)
}

export function listInvestigations() {
  return request<InvestigationRecord[]>('/api/investigations')
}

export function getInvestigation(id: string) {
  return request<InvestigationRecord>(`/api/investigations/${encodeURIComponent(id)}`)
}

export async function getReport(id: string) {
  let response: Response
  try {
    response = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(id)}`)
  } catch {
    throw new Error('The analysis service is unavailable. Connect the FastAPI backend and try again.')
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(formatApiError(detail, response.headers.get('content-type'), `The report service returned ${response.status}.`))
  }

  return response.blob()
}

export function getSafeVisualizationUrl(path: string) {
  if (typeof path !== 'string' || !path.trim()) return null
  if (/^data:image\/(?:png|jpe?g|webp);base64,/i.test(path)) return path
  if (typeof window === 'undefined' && !API_BASE) return path.startsWith('/') && !path.startsWith('//') ? path : null

  try {
    const pageOrigin = typeof window === 'undefined' ? 'https://truthlens.invalid' : window.location.origin
    const baseUrl = API_BASE || pageOrigin
    const url = new URL(path, baseUrl)
    const allowedOrigin = new URL(baseUrl).origin
    if (url.origin !== allowedOrigin || !['http:', 'https:'].includes(url.protocol)) return null
    return url.toString()
  } catch {
    return null
  }
}
