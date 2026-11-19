import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from './logger'
import { ARTIFACTS_TEMP_DIR } from './cloud-storage'
import type { AudioForensicMetrics, AudioForensicSegment } from './types'

const execFileAsync = promisify(execFile)

export interface SuspiciousRegion {
  id: string
  box: [number, number, number, number] // [x, y, width, height]
  deepfakeProbability: number
  label: string
  description: string
  confidence: number
}

export interface ModelImageResult {
  status: 'success' | 'error'
  modelName: string
  modelVersion: string
  deepfakeProbability: number
  realProbability: number
  confidence: number
  predictedLabel: string
  assessment: string
  uncertaintyStatus:
    | 'Likely AI-Generated'
    | 'Likely Manipulated'
    | 'No Significant Indicators Detected'
    | 'Inconclusive'
    | 'Potentially Manipulated'
    | 'Requires Further Review'
  facesCount: number
  faces: Array<{ box: [number, number, number, number]; confidence: number }>
  suspiciousRegions: SuspiciousRegion[]
  visualizations: Array<{ label: string; url: string }>
  forensicMetrics?: {
    neuralDeepfakeProb?: number
    fftSpikeScore?: number
    fftEnergyRatio?: number
    noiseInconsistency?: number
    meanNoiseVar?: number
    elaMeanDiff?: number
    elaMaxDiff?: number
    hasPeriodicArtifacts?: boolean
    hasNoiseDisparity?: boolean
    hasElaDiscrepancy?: boolean
    hasMetadataProvenance?: boolean
    isGenerativeProvenance?: boolean
    softwareSignatures?: string[]
  }
  limitations: string[]
  message?: string
}

export interface ModelVideoResult {
  status: 'success' | 'error'
  modelName: string
  modelVersion: string
  totalFramesAnalyzed: number
  duplicateFramesSkipped?: number
  nativeFps: number
  durationSec: number
  maxDeepfakeScore: number
  meanDeepfakeScore: number
  anomalousFrameCount: number
  anomalousFrames: Array<{
    frameIndex: number
    timestamp: string
    seconds: number
    score: number
    facesCount: number
  }>
  suspiciousTimestamps: Array<{
    timestamp: string
    seconds: number
    label: string
    description: string
    evidenceRef?: string
    severity: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  }>
  visualizations: Array<{ label: string; url: string }>
  limitations: string[]
  message?: string
}

export interface ModelAudioResult {
  status: 'success' | 'error'
  sampleRate: number
  channels: number
  durationSec: number
  syntheticProbability: number
  authenticProbability?: number
  confidence?: number
  predictedLabel?: string
  uncertaintyStatus?: string
  assessment?: string
  modelName?: string
  modelVersion?: string
  highFreqRatio: number
  spectralFlux: number
  spectralFlatness?: number
  snrDb?: number
  voiceActivityRatio?: number
  phaseInconsistency?: number
  jitterPercent?: number
  shimmerPercent?: number
  highFreqCutoffHz?: number
  reasons: string[]
  segments?: AudioForensicSegment[]
  suspiciousTimestamps?: Array<{
    timestamp: string
    seconds: number
    label: string
    description: string
    severity: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  }>
  visualizations: Array<{ label: string; url: string }>
  mfccMeanVector?: number[]
  limitations: string[]
  message?: string
}

export class ModelService {
  private scriptPath: string
  private outputDir: string
  private aiServiceUrl: string
  private aiServiceApiKey: string
  private cachedAvailability: {
    data: { available: boolean; vitModel: boolean; yunetModel: boolean; errors: string[] }
    timestamp: number
  } | null = null

  constructor() {
    this.scriptPath = path.join(process.cwd(), 'lib', 'backend-engine', 'python-engine', 'deepfake_detector.py')
    this.outputDir = ARTIFACTS_TEMP_DIR
    this.aiServiceUrl = (process.env.AI_SERVICE_URL || process.env.PYTHON_INFERENCE_URL || '').replace(/\/$/, '')
    this.aiServiceApiKey = process.env.AI_SERVICE_API_KEY || ''

    try {
      if (!fs.existsSync(this.outputDir)) {
        fs.mkdirSync(this.outputDir, { recursive: true })
      }
    } catch {
      // Non-fatal if temp directory creation delayed
    }

    if (this.aiServiceUrl) {
      if (process.env.NODE_ENV === 'production' && !this.aiServiceApiKey) {
        logger.error('CRITICAL: AI_SERVICE_API_KEY is required in production when AI_SERVICE_URL is configured.')
      }
      logger.info(`ModelService initialized with remote AI inference URL: ${this.aiServiceUrl}`)
    } else {
      logger.info('ModelService initialized using local Python deepfake engine')
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.aiServiceApiKey) {
      headers['X-API-Key'] = this.aiServiceApiKey
      headers['Authorization'] = `Bearer ${this.aiServiceApiKey}`
    }
    return headers
  }

  private extractJson<T>(raw: string): T {
    const firstBrace = raw.indexOf('{')
    const lastBrace = raw.lastIndexOf('}')
    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      throw new Error(`Invalid JSON output from model engine: ${raw.slice(0, 200)}`)
    }
    const cleanJson = raw.slice(firstBrace, lastBrace + 1)
    return JSON.parse(cleanJson) as T
  }

  /**
   * Check if the neural models and Python dependencies are ready and operational.
   * Caches response for 60 seconds to eliminate redundant process spawns or network calls.
   */
  async checkModelAvailability(): Promise<{
    available: boolean
    vitModel: boolean
    yunetModel: boolean
    errors: string[]
  }> {
    const now = Date.now()
    if (this.cachedAvailability && now - this.cachedAvailability.timestamp < 60000) {
      return this.cachedAvailability.data
    }

    // 1. Try remote AI microservice if configured
    if (this.aiServiceUrl) {
      try {
        let response = await fetch(`${this.aiServiceUrl}/api/v1/models/availability`, {
          headers: this.getAuthHeaders(),
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok && response.status === 404) {
          response = await fetch(`${this.aiServiceUrl}/models`, {
            headers: this.getAuthHeaders(),
            signal: AbortSignal.timeout(5000),
          })
        }
        if (response.ok) {
          const data = await response.json()
          const result = {
            available: Boolean(data.available),
            vitModel: Boolean(data.vitModel),
            yunetModel: Boolean(data.yunetModel),
            errors: Array.isArray(data.errors) ? data.errors : [],
          }
          this.cachedAvailability = { data: result, timestamp: now }
          return result
        }
      } catch (remoteErr) {
        logger.warn(`Remote AI availability check failed at ${this.aiServiceUrl}, checking local fallback`, remoteErr)
      }
    }

    // 2. Local Python CLI fallback
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_AI_FALLBACK !== 'true') {
      logger.error('CRITICAL: Remote AI inference service (AI_SERVICE_URL) is required in production. Local Python CLI fallback is disabled.')
      const errorResult = {
        available: false,
        vitModel: false,
        yunetModel: false,
        errors: ['Remote AI service (AI_SERVICE_URL) unavailable or not configured. Local Python execution disabled in production.'],
      }
      this.cachedAvailability = { data: errorResult, timestamp: now }
      return errorResult
    }

    try {
      const { stdout } = await execFileAsync('python', [this.scriptPath, '--action', 'ping'], {
        timeout: 10000,
        windowsHide: true,
      })
      const result = this.extractJson<{ available: boolean; vitModel: boolean; yunetModel: boolean; errors: string[] }>(stdout)
      this.cachedAvailability = { data: result, timestamp: now }
      return result
    } catch (err) {
      logger.warn('Deepfake model availability check failed', err)
      const errorResult = {
        available: false,
        vitModel: false,
        yunetModel: false,
        errors: [err instanceof Error ? err.message : String(err)],
      }
      this.cachedAvailability = { data: errorResult, timestamp: now }
      return errorResult
    }
  }

  /**
   * Perform neural deepfake detection and face region localization on an image.
   * Supports both remote AI microservice and local engine execution.
   */
  async analyzeImage(imagePath: string): Promise<ModelImageResult | null> {
    // 1. Remote AI Microservice
    if (this.aiServiceUrl) {
      try {
        const buffer = await fsp.readFile(imagePath)
        const filename = path.basename(imagePath)
        const formData = new FormData()
        formData.append('file', new Blob([buffer]), filename)

        const response = await fetch(`${this.aiServiceUrl}/api/v1/analyze/image`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: formData,
          signal: AbortSignal.timeout(30000),
        })

        if (response.ok) {
          const res = (await response.json()) as ModelImageResult
          if (res.status !== 'error') return res
        }
        logger.warn(`Remote AI image analysis responded with error status, attempting local fallback`)
      } catch (remoteErr) {
        logger.warn(`Failed remote AI image inference at ${this.aiServiceUrl}, falling back to local Python`, remoteErr)
      }
    }

    // 2. Local Python Execution Fallback
    if (this.aiServiceUrl && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_AI_FALLBACK !== 'true') {
      logger.error('CRITICAL: Remote AI image inference failed and ALLOW_LOCAL_AI_FALLBACK is disabled.')
      return null
    }

    const pythonBin = process.env.PYTHON_PATH || 'python'
    try {
      const { stdout } = await execFileAsync(
        pythonBin,
        [this.scriptPath, '--action', 'analyze_image', '--input', imagePath, '--output_dir', this.outputDir],
        { timeout: 45000, windowsHide: true }
      )
      const res = this.extractJson<ModelImageResult>(stdout)
      if (res.status === 'error') {
        logger.warn(`Model image analysis error: ${res.message}`)
        return null
      }
      return res
    } catch (err) {
      logger.error('Failed to execute deepfake model on image', err)
      return null
    }
  }

  /**
   * Perform temporal frame-by-frame neural deepfake detection on video.
   * Supports both remote AI microservice and local engine execution.
   */
  async analyzeVideo(videoPath: string, sampleFps = 1.0, maxFrames = 45): Promise<ModelVideoResult | null> {
    // 1. Remote AI Microservice
    if (this.aiServiceUrl) {
      try {
        const buffer = await fsp.readFile(videoPath)
        const filename = path.basename(videoPath)
        const formData = new FormData()
        formData.append('file', new Blob([buffer]), filename)

        const query = new URLSearchParams({
          sample_fps: String(sampleFps),
          max_frames: String(maxFrames),
        })

        const response = await fetch(`${this.aiServiceUrl}/api/v1/analyze/video?${query.toString()}`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: formData,
          signal: AbortSignal.timeout(60000),
        })

        if (response.ok) {
          const res = (await response.json()) as ModelVideoResult
          if (res.status !== 'error') return res
        }
        logger.warn(`Remote AI video analysis responded with error status, attempting local fallback`)
      } catch (remoteErr) {
        logger.warn(`Failed remote AI video inference at ${this.aiServiceUrl}, falling back to local Python`, remoteErr)
      }
    }

    // 2. Local Python Execution Fallback
    if (this.aiServiceUrl && process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_AI_FALLBACK !== 'true') {
      logger.error('CRITICAL: Remote AI video inference failed or is not configured in production. Local Python fallback is disabled.')
      return null
    }

    try {
      const pyCmd = process.env.PYTHON_PATH || 'python'
      const { stdout } = await execFileAsync(
        pyCmd,
        [
          this.scriptPath,
          '--action',
          'analyze_video',
          '--input',
          videoPath,
          '--output_dir',
          this.outputDir,
          '--sample_fps',
          String(sampleFps),
          '--max_frames',
          String(maxFrames),
        ],
        { timeout: 60000, windowsHide: true }
      )
      const res = this.extractJson<ModelVideoResult>(stdout)
      if (res.status === 'error') {
        logger.warn(`Model video analysis error: ${res.message}`)
        return null
      }
      return res
    } catch (err) {
      logger.error('Failed to execute deepfake model on video', err)
      return null
    }
  }

  /**
   * Perform acoustic spectral analysis and STFT spectrogram rendering on audio.
   * Supports both remote AI microservice and local engine execution.
   */
  async analyzeAudio(audioPath: string): Promise<ModelAudioResult | null> {
    // 1. Remote AI Microservice
    if (this.aiServiceUrl) {
      try {
        const buffer = await fsp.readFile(audioPath)
        const filename = path.basename(audioPath)
        const formData = new FormData()
        formData.append('file', new Blob([buffer]), filename)

        const response = await fetch(`${this.aiServiceUrl}/api/v1/analyze/audio`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: formData,
          signal: AbortSignal.timeout(20000),
        })

        if (response.ok) {
          const res = (await response.json()) as ModelAudioResult
          if (res.status !== 'error') return res
        }
        logger.warn(`Remote AI audio analysis responded with error status, attempting local fallback`)
      } catch (remoteErr) {
        logger.warn(`Failed remote AI audio inference at ${this.aiServiceUrl}, falling back to local Python`, remoteErr)
      }
    }

    // 2. Local Python Execution Fallback
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_LOCAL_AI_FALLBACK !== 'true') {
      logger.error('CRITICAL: Remote AI audio inference failed or is not configured in production. Local Python fallback is disabled.')
      return null
    }

    try {
      const { stdout } = await execFileAsync(
        'python',
        [this.scriptPath, '--action', 'analyze_audio', '--input', audioPath, '--output_dir', this.outputDir],
        { timeout: 20000, windowsHide: true }
      )
      const res = this.extractJson<ModelAudioResult>(stdout)
      if (res.status === 'error') {
        logger.warn(`Model audio analysis error: ${res.message}`)
        return null
      }
      return res
    } catch (err) {
      logger.error('Failed to execute spectral model on audio', err)
      return null
    }
  }

  /**
   * Extract video frames via OpenCV when FFmpeg is not installed.
   */
  async extractVideoFramesOpenCV(
    videoPath: string,
    framesDir: string,
    sampleFps = 1.0,
    maxFrames = 45
  ): Promise<{ extractedFrames: string[]; error?: string }> {
    try {
      const { stdout } = await execFileAsync(
        'python',
        [
          this.scriptPath,
          '--action',
          'extract_frames',
          '--input',
          videoPath,
          '--output_dir',
          framesDir,
          '--sample_fps',
          String(sampleFps),
          '--max_frames',
          String(maxFrames),
        ],
        { timeout: 30000, windowsHide: true }
      )
      const res = this.extractJson<{ status: string; extractedFrames: string[]; message?: string }>(stdout)
      if (res.status === 'success' && Array.isArray(res.extractedFrames)) {
        return { extractedFrames: res.extractedFrames }
      }
      return { extractedFrames: [], error: res.message || 'Frame extraction failed.' }
    } catch (err) {
      return { extractedFrames: [], error: err instanceof Error ? err.message : String(err) }
    }
  }
}

export const modelService = new ModelService()
