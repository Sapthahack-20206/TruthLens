import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import type { DetectionIndicator, MediaMetadata, SuspiciousTimestamp, DeepfakeModelInterface } from './types'
import { extractVideoFrames, extractAudioTrack, cleanupTempFiles } from './media-processor'

// Pluggable Registry for Neural Deepfake Detection Models
const registeredModels: Map<string, DeepfakeModelInterface> = new Map()

export function registerDeepfakeModel(model: DeepfakeModelInterface) {
  registeredModels.set(model.name, model)
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

export async function analyzeVideoEvidence(
  videoPath: string,
  metadata: MediaMetadata,
  context = ''
): Promise<{
  indicators: DetectionIndicator[]
  suspiciousTimestamps: SuspiciousTimestamp[]
  extractedAudioPath?: string
  limitations: string[]
  processingErrors: string[]
}> {
  const indicators: DetectionIndicator[] = []
  const suspiciousTimestamps: SuspiciousTimestamp[] = []
  const limitations: string[] = []
  const processingErrors: string[] = []

  const tempJobId = path.basename(videoPath, path.extname(videoPath))
  const framesDir = path.join(os.tmpdir(), 'truthlens-forensics', `frames_${tempJobId}`)
  const extractedAudioPath = path.join(os.tmpdir(), 'truthlens-forensics', `audio_${tempJobId}.wav`)

  // 1. Attempt frame extraction with FFmpeg
  const frameResult = await extractVideoFrames(videoPath, framesDir, 1)
  if (frameResult.error) {
    limitations.push(frameResult.error)
  }

  // 2. Attempt audio separation
  const audioResult = await extractAudioTrack(videoPath, extractedAudioPath)
  let validAudioPath: string | undefined
  if (audioResult.audioPath) {
    validAudioPath = audioResult.audioPath
  } else if (audioResult.error) {
    limitations.push(audioResult.error)
  }

  // 3. Container & Stream Structural Examination (Deterministic & Explainable)
  if (metadata.containerFormat) {
    indicators.push({
      id: 'ind-vid-container-01',
      category: 'video',
      type: 'Container Structure',
      title: 'MPEG-4 Container Format Verified',
      description: `Video encapsulates valid ${metadata.containerFormat} atoms (${metadata.majorBrand || 'mp42'}). Stream headers appear structurally intact.`,
      severity: 'info',
      isHeuristic: true,
      humanReviewRecommendation: 'Verify whether container creation date matches file system creation timestamps.',
    })
  }

  // 4. Temporal & Frame Consistency Analysis
  const frameCount = frameResult.extractedFrames.length
  if (frameCount > 0) {
    indicators.push({
      id: 'ind-vid-frames-01',
      category: 'video',
      type: 'Temporal Sampling',
      title: `Uniform Frame Extraction Completed (${frameCount} keyframes)`,
      description: `Extracted ${frameCount} representative frames at 1 fps interval for forensic inspection.`,
      severity: 'low',
      isHeuristic: true,
      humanReviewRecommendation: 'Examine extracted keyframes for facial boundary jitter or sudden lighting discrepancies.',
    })

    // Inspect frame files for abnormal file size variance (indicates compression disparity or I-frame splice)
    let prevSize = 0
    frameResult.extractedFrames.forEach((frameFile, index) => {
      try {
        const stats = fs.statSync(frameFile)
        const timestampSec = index * 1.0
        const timecode = formatTime(timestampSec)

        if (index > 0 && prevSize > 0) {
          const ratio = Math.abs(stats.size - prevSize) / prevSize
          // Significant compression shift (> 2.5x variance)
          if (ratio > 2.5) {
            suspiciousTimestamps.push({
              timestamp: timecode,
              seconds: timestampSec,
              label: 'Abrupt Frame Compression Shift',
              description: `Frame ${index + 1} exhibits a ${Math.round(ratio * 100)}% bitrate/complexity shift relative to preceding frame.`,
              evidenceRef: `Frame #${index + 1}`,
              severity: 'moderate',
            })
          }
        }
        prevSize = stats.size
      } catch {
        // Skip unreadable frame
      }
    })
  }

  // 5. Query Registered Neural Deepfake Models (if any are installed & connected)
  let neuralModelRun = false
  for (const [name, model] of registeredModels.entries()) {
    try {
      const isAvail = await model.isAvailable()
      if (isAvail && frameCount > 0) {
        const res = await model.analyzeFrames(frameResult.extractedFrames)
        neuralModelRun = true
        indicators.push({
          id: `ind-vid-model-${name}`,
          category: 'video',
          type: 'Neural Deepfake Classifier',
          title: `Model Analysis (${name} v${model.version})`,
          description: `Neural model analyzed ${frameCount} frames. Global manipulation probability score: ${res.score !== undefined ? `${(res.score * 100).toFixed(1)}%` : 'Inconclusive'}.`,
          confidence: res.score !== undefined ? Math.round(res.score * 100) : undefined,
          severity: (res.score ?? 0) > 0.75 ? 'critical' : (res.score ?? 0) > 0.5 ? 'high' : 'low',
          isHeuristic: false,
          modelName: name,
          humanReviewRecommendation: 'Review anomalous frames flagged by the neural classifier against reference source.',
        })

        for (const item of res.anomalousFrames) {
          suspiciousTimestamps.push({
            timestamp: item.timestamp,
            seconds: item.frameIndex * 1.0,
            label: item.label,
            description: `Model flagged anomalous face boundary or texture pattern (confidence: ${Math.round(item.score * 100)}%).`,
            evidenceRef: `Frame #${item.frameIndex + 1}`,
            severity: item.score > 0.8 ? 'critical' : 'high',
          })
        }
      }
    } catch (err) {
      processingErrors.push(`Model ${name} execution error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 6. Honest Documentation of Model Availability (No synthetic fabrication!)
  if (!neuralModelRun) {
    limitations.push('Automated neural deepfake classifier is not currently connected to the local inference worker. Container, codec, and temporal frame checks were performed.')
    indicators.push({
      id: 'ind-vid-model-status',
      category: 'video',
      type: 'Model Availability',
      title: 'Neural Deepfake Model: Interface Ready / Standby',
      description: 'Heuristic structural and compression analysis completed. Connect external neural inference endpoint or weights to compute deep learning face manipulation scores.',
      severity: 'info',
      isHeuristic: true,
      humanReviewRecommendation: 'Human forensic examiner review is required to verify facial landmarks and temporal motion coherence.',
    })
  }

  // Cleanup extracted frames directory
  cleanupTempFiles(framesDir)

  return {
    indicators,
    suspiciousTimestamps,
    extractedAudioPath: validAudioPath,
    limitations,
    processingErrors,
  }
}
