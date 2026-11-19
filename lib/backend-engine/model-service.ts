import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from './logger'

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
  predictedLabel: 'Deepfake' | 'Real'
  assessment: string
  uncertaintyStatus: 'Potentially Manipulated' | 'No Significant Indicators Detected' | 'Requires Further Review'
  facesCount: number
  faces: Array<{ box: [number, number, number, number]; confidence: number }>
  suspiciousRegions: SuspiciousRegion[]
  visualizations: Array<{ label: string; url: string }>
  limitations: string[]
  message?: string
}

export interface ModelVideoResult {
  status: 'success' | 'error'
  modelName: string
  modelVersion: string
  totalFramesAnalyzed: number
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
  highFreqRatio: number
  spectralFlux: number
  reasons: string[]
  visualizations: Array<{ label: string; url: string }>
  limitations: string[]
  message?: string
}

export class ModelService {
  private scriptPath: string
  private outputDir: string
  private cachedAvailability: {
    data: { available: boolean; vitModel: boolean; yunetModel: boolean; errors: string[] }
    timestamp: number
  } | null = null

  constructor() {
    this.scriptPath = path.join(process.cwd(), 'lib', 'backend-engine', 'python-engine', 'deepfake_detector.py')
    this.outputDir = path.join(process.cwd(), 'public', 'forensic-output')
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }
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
   * Caches response for 60 seconds to eliminate redundant process spawns.
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
   */
  async analyzeImage(imagePath: string): Promise<ModelImageResult | null> {
    try {
      const { stdout } = await execFileAsync(
        'python',
        [this.scriptPath, '--action', 'analyze_image', '--input', imagePath, '--output_dir', this.outputDir],
        { timeout: 30000, windowsHide: true }
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
   */
  async analyzeVideo(videoPath: string, sampleFps = 1.0, maxFrames = 45): Promise<ModelVideoResult | null> {
    try {
      const { stdout } = await execFileAsync(
        'python',
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
   */
  async analyzeAudio(audioPath: string): Promise<ModelAudioResult | null> {
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
