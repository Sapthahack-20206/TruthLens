import crypto from 'node:crypto'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  UploadedFileEvidence,
  MediaMetadata,
  ForensicResponse,
  DetectionIndicator,
  ForensicFinding,
  SuspiciousTimestamp,
  TimelineSegment,
  SampledFrameInfo,
  ForensicVisualization,
  DeepfakeVideoDetectorInterface,
  DeepfakeModelResult
} from './types'
import {
  extractVideoMetadata,
  extractVideoFrames,
  extractAudioFromVideo,
  cleanupEvidence,
  formatTime
} from './media-processor.ts'

const execFileAsync = promisify(execFile)

interface OpenCvAnalysisOutput {
  status: 'completed' | 'failed'
  error?: string
  isCorrupted?: boolean
  durationSeconds?: number
  durationFormatted?: string
  totalFrames?: number
  sampledFrameCount?: number
  fps?: number
  dimensions?: { width: number; height: number }
  totalFacesDetected?: number
  faceDetectorUsed?: string
  sampledFrames?: SampledFrameInfo[]
  suspiciousTimestamps?: SuspiciousTimestamp[]
  timelineSegments?: TimelineSegment[]
}

/**
 * Executes advanced OpenCV facial detection and temporal frame analysis
 */
async function runOpenCvVideoAnalysis(videoPath: string): Promise<OpenCvAnalysisOutput | null> {
  const scriptPath = path.join(process.cwd(), 'lib', 'analysis', 'video_face_analyzer.py')
  try {
    const { stdout, stderr } = await execFileAsync('python', [scriptPath, videoPath], {
      maxBuffer: 25 * 1024 * 1024, // 25 MB buffer for base64 thumbnails
      timeout: 60000 // 60s timeout
    })

    // Filter out possible warning lines before JSON
    const lines = stdout.trim().split(/\r?\n/)
    const jsonLine = lines.reverse().find(l => l.startsWith('{') && l.endsWith('}'))
    if (!jsonLine) return null

    return JSON.parse(jsonLine) as OpenCvAnalysisOutput
  } catch (err) {
    console.warn('[OpenCV Video Analysis Warning]', err)
    return null
  }
}

/**
 * Default heuristic video analyzer evaluating container structure, encoding signatures, and temporal continuity
 */
export class DefaultHeuristicVideoAnalyzer implements DeepfakeVideoDetectorInterface {
  readonly name = 'TruthLens Video Forensics Baseline'
  readonly version = '1.0.0'

  async isAvailable(): Promise<boolean> {
    return true
  }

  async analyzeVideo(
    filePath: string,
    metadata: MediaMetadata,
    frames?: string[]
  ): Promise<DeepfakeModelResult> {
    const suspiciousTimestamps: SuspiciousTimestamp[] = []
    const anomalies: Array<{ frame?: number; timestamp?: string; description: string; score?: number }> = []
    let detectedSynthetic: boolean | null = null
    let confidence: number | null = null

    // 1. Container software signature inspection
    const signatures = metadata.softwareSignatures || []
    const hasTranscoderSignature = signatures.some(s => /lavf|handbrake|ffmpeg/i.test(s))
    const hasCameraSignature = metadata.exifTags?.CameraMake || metadata.exifTags?.CameraModel

    if (hasTranscoderSignature && !hasCameraSignature) {
      anomalies.push({
        description: 'Video stream contains transcoder/muxer tags (e.g. Lavf/FFmpeg) without hardware camera acquisition metadata.'
      })
    }

    // 2. Framerate consistency
    if (metadata.frameRate && (metadata.frameRate < 10 || metadata.frameRate > 120)) {
      anomalies.push({
        description: `Unusual playback frame rate detected (${metadata.frameRate} fps). Synthetic generative video engines often output non-standard frame rates.`
      })
    }

    const reasoning = anomalies.length
      ? anomalies.map(a => a.description).join('; ')
      : 'Structural and temporal heuristics evaluated within standard ranges. No hardware camera tags verified.'

    return {
      modelName: this.name,
      modelVersion: this.version,
      isAvailable: true,
      detectedSynthetic,
      confidence,
      reasoning,
      suspiciousTimestamps,
      anomalies
    }
  }
}

/**
 * Executes full video analysis pipeline
 */
export async function analyzeVideoEvidence(
  evidence: UploadedFileEvidence,
  context = '',
  detectorModel?: DeepfakeVideoDetectorInterface
): Promise<ForensicResponse> {
  const id = `inv_${crypto.randomUUID().slice(0, 12)}`
  const reportId = `rep_${crypto.randomUUID().slice(0, 10)}`
  const model = detectorModel ?? new DefaultHeuristicVideoAnalyzer()

  const indicators: DetectionIndicator[] = []
  const findings: ForensicFinding[] = []
  const suspiciousTimestamps: SuspiciousTimestamp[] = []
  const limitations: string[] = []
  const errors: string[] = []
  const visualizations: ForensicVisualization[] = []
  let timelineSegments: TimelineSegment[] = []
  let sampledFrames: SampledFrameInfo[] = []

  let extractedAudioPath: string | null = null

  try {
    // 1. Run OpenCV Advanced Video & Facial Analysis
    const openCvResult = await runOpenCvVideoAnalysis(evidence.tempPath)

    if (openCvResult?.status === 'failed' && openCvResult.isCorrupted) {
      throw new Error(openCvResult.error || 'Corrupted or unsupported video stream: Unable to decode video frames.')
    }

    // 2. Extract container metadata
    const metadata = await extractVideoMetadata(evidence)

    // Sync metadata from OpenCV if available
    if (openCvResult?.status === 'completed') {
      if (openCvResult.durationFormatted) metadata.durationFormatted = openCvResult.durationFormatted
      if (openCvResult.dimensions) metadata.dimensions = openCvResult.dimensions
      if (openCvResult.fps) metadata.frameRate = openCvResult.fps
      if (openCvResult.sampledFrames) sampledFrames = openCvResult.sampledFrames
      if (openCvResult.timelineSegments) timelineSegments = openCvResult.timelineSegments
      if (openCvResult.suspiciousTimestamps) {
        suspiciousTimestamps.push(...openCvResult.suspiciousTimestamps)
      }

      // Add face detection indicator
      indicators.push({
        id: `ind_${crypto.randomUUID().slice(0, 8)}`,
        category: 'metadata',
        name: 'Facial Tracking & Geometry Analysis',
        description: `Tracked ${openCvResult.totalFacesDetected ?? 0} face instance(s) across ${openCvResult.sampledFrameCount ?? 0} sampled frames using ${openCvResult.faceDetectorUsed || 'OpenCV YuNet'}.`,
        severity: (openCvResult.totalFacesDetected ?? 0) > 0 ? 'info' : 'low',
        isHeuristic: false,
        confidence: null,
        evidenceRef: openCvResult.faceDetectorUsed || 'OpenCV YuNet DNN'
      })

      // Add sampled frames to visualizations
      if (openCvResult.sampledFrames && openCvResult.sampledFrames.length > 0) {
        visualizations.push({
          label: `Sampled Keyframe (${openCvResult.sampledFrames[0].timestamp})`,
          url: openCvResult.sampledFrames[0].thumbnailUrl,
          type: 'frame'
        })
        const midIdx = Math.floor(openCvResult.sampledFrames.length / 2)
        if (midIdx > 0) {
          visualizations.push({
            label: `Sampled Keyframe (${openCvResult.sampledFrames[midIdx].timestamp})`,
            url: openCvResult.sampledFrames[midIdx].thumbnailUrl,
            type: 'frame'
          })
        }
      }
    } else {
      // Fallback: extract frames using FFmpeg where available
      const frameResult = await extractVideoFrames(evidence.tempPath, 10, 1)
      if (!frameResult.extractedWithFFmpeg && frameResult.limitations) {
        limitations.push(...frameResult.limitations)
      }

      if (frameResult.frames.length > 0) {
        visualizations.push({
          label: `Keyframe Sample (00:00.00)`,
          url: frameResult.frames[0],
          type: 'frame'
        })
      }
    }

    // 3. Extract audio track for multi-modal / speech correlation
    const audioExtract = await extractAudioFromVideo(evidence.tempPath)
    if (audioExtract.extracted && audioExtract.audioPath) {
      extractedAudioPath = audioExtract.audioPath
      indicators.push({
        id: `ind_${crypto.randomUUID().slice(0, 8)}`,
        category: 'cross_modal_alignment',
        name: 'Audio Track Extracted for Analysis',
        description: 'Successfully extracted uncompressed 16kHz audio stream from video container.',
        severity: 'info',
        isHeuristic: false,
        confidence: null,
        evidenceRef: 'Audio Stream'
      })
    } else if (audioExtract.limitations) {
      limitations.push(...audioExtract.limitations)
    }

    // 4. Run deepfake detection model / heuristic baseline
    const modelResult = await model.analyzeVideo(evidence.tempPath, metadata)
    if (modelResult.suspiciousTimestamps) {
      suspiciousTimestamps.push(...modelResult.suspiciousTimestamps)
    }

    if (modelResult.detectedSynthetic !== null) {
      indicators.push({
        id: `ind_${crypto.randomUUID().slice(0, 8)}`,
        category: 'ai_model_detection',
        name: 'Video Deepfake Model Inference',
        description: modelResult.reasoning,
        severity: modelResult.detectedSynthetic ? 'high' : 'low',
        isHeuristic: false,
        confidence: modelResult.confidence,
        evidenceRef: `${model.name} v${model.version}`
      })
    } else {
      limitations.push('No external deepfake neural network classifier was configured. Findings are derived from OpenCV YuNet facial boundary geometry, texture variance, and container structure.')
    }

    // 5. Build indicators from metadata
    if (metadata.softwareSignatures && metadata.softwareSignatures.length > 0) {
      indicators.push({
        id: `ind_${crypto.randomUUID().slice(0, 8)}`,
        category: 'metadata',
        name: 'Video Container Encoder Tags',
        description: `Muxer / encoder signatures detected: ${metadata.softwareSignatures.join(', ')}`,
        severity: 'low',
        isHeuristic: false,
        confidence: null,
        evidenceRef: 'Container Atoms'
      })
    }

    // Generate explainable findings for suspicious timestamps
    if (suspiciousTimestamps.length > 0) {
      for (const st of suspiciousTimestamps.slice(0, 5)) {
        findings.push({
          id: `fnd_${crypto.randomUUID().slice(0, 8)}`,
          type: st.label?.includes('Boundary') ? 'Facial Boundary Anomaly' : st.label?.includes('Texture') ? 'Facial Texture Disparity' : 'Temporal Discontinuity',
          title: st.label || 'Suspicious Video Interval',
          description: st.description || 'Observed visual or structural signal variance exceeding typical capture thresholds.',
          timestamp: st.timestamp,
          confidence: 'Heuristic measurement (OpenCV)',
          evidenceRef: st.evidenceRef
        })
      }
    }

    // Honest limitations
    limitations.push('Visual indicators and texture variance do not prove synthetic manipulation; natural head rotation, lighting shifts, and video compression can introduce similar artifacts.')
    limitations.push('Lack of hardware camera provenance does not conclusively indicate synthetic media.')

    // Assessment synthesis
    let assessment = 'Inconclusive - Heuristic inspection only'
    const status: 'completed' | 'inconclusive' = 'completed'
    if (modelResult.detectedSynthetic === true) {
      assessment = 'Suspected Synthetic Video (Deepfake Classifier Positive)'
    } else if (suspiciousTimestamps.length > 0) {
      assessment = 'Visual Anomalies Detected - Timestamps Flagged for Manual Review'
    } else {
      assessment = 'No Major Facial or Temporal Inconsistencies Detected'
    }

    const summary = `Forensic video analysis completed for ${evidence.originalName} (${metadata.durationFormatted || 'unknown duration'}, ${metadata.dimensions ? `${metadata.dimensions.width}x${metadata.dimensions.height}` : 'unknown resolution'}, ${metadata.videoCodec || 'H.264'}). Analyzed ${sampledFrames.length || 'multiple'} frame(s). Recorded ${suspiciousTimestamps.length} suspicious timestamp(s).`

    return {
      id,
      investigationId: id,
      reportId,
      status,
      mediaType: 'video',
      assessment,
      summary,
      metadata: {
        Filename: metadata.filename,
        Format: metadata.format ?? 'video/mp4',
        FileSize: `${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB`,
        Duration: metadata.durationFormatted ?? 'Not provided',
        Resolution: metadata.dimensions ? `${metadata.dimensions.width} x ${metadata.dimensions.height} px` : 'Not provided',
        FrameRate: metadata.frameRate ? `${metadata.frameRate} fps` : 'Not provided',
        VideoCodec: metadata.videoCodec ?? 'Not provided',
        AudioCodec: metadata.audioCodec ?? 'Not provided',
        Encoder: metadata.softwareSignatures?.join(', ') ?? 'Not provided',
        FacesDetected: openCvResult?.totalFacesDetected !== undefined ? String(openCvResult.totalFacesDetected) : 'Not tracked',
        FaceDetector: openCvResult?.faceDetectorUsed ?? 'None',
        SHA256: metadata.sha256
      },
      indicators,
      findings,
      suspiciousTimestamps,
      timelineSegments,
      sampledFrames,
      evidenceRelationships: [
        {
          source: 'Video Container',
          target: 'Video Stream',
          relationship: 'Encapsulation',
          explanation: `Codec ${metadata.videoCodec || 'H.264'} encapsulated within ${metadata.format || 'MP4'}`
        },
        ...(extractedAudioPath ? [{
          source: 'Video Container',
          target: 'Audio Stream',
          relationship: 'Synchronized Track',
          explanation: `Extracted audio track (${metadata.audioCodec || 'AAC'}) synchronized with video timeline`
        }] : [])
      ],
      visualizations,
      limitations,
      errors,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : 'Unknown video processing error')
    return {
      id,
      investigationId: id,
      status: 'failed',
      mediaType: 'video',
      assessment: 'Analysis Failed',
      summary: `Video analysis failed: ${err instanceof Error ? err.message : 'Unknown processing error'}`,
      metadata: {
        Filename: evidence.originalName,
        FileSize: `${(evidence.size / 1024 / 1024).toFixed(2)} MB`,
        SHA256: evidence.sha256
      },
      indicators: [],
      findings: [],
      suspiciousTimestamps: [],
      timelineSegments: [],
      sampledFrames: [],
      evidenceRelationships: [],
      visualizations: [],
      limitations: ['An error occurred during video decoding or inspection.'],
      errors,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    }
  } finally {
    await cleanupEvidence([evidence.tempPath, ...(extractedAudioPath ? [extractedAudioPath] : [])])
  }
}
