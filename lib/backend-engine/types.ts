export interface MediaMetadata {
  filename: string
  fileSize: number
  mimeType: string
  hashSha256: string
  extension: string
  duration?: number
  resolution?: { width: number; height: number }
  channels?: number
  sampleRate?: number
  bitrate?: number
  fps?: number
  codec?: string
  colorSpace?: string
  cameraModel?: string
  software?: string
  createdAt?: string
  modifiedAt?: string
  [key: string]: unknown
}

export interface DetectionIndicator {
  id: string
  category: 'video' | 'audio' | 'image' | 'transcript' | 'cross-modal'
  type: string
  title: string
  description: string
  timestamp?: string
  frameNumber?: number
  evidenceRef?: string
  confidence?: number
  severity: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  isHeuristic: boolean
  modelName?: string
  humanReviewRecommendation?: string
}

export interface SuspiciousTimestamp {
  timestamp: string
  seconds: number
  frameNumber?: number
  label: string
  description: string
  evidenceRef?: string
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
  anomalyType?: string
  metricValue?: string
  isHeuristic?: boolean
  faceDetected?: boolean
  faceBoundingBox?: { x: number; y: number; width: number; height: number }
  previewThumbnail?: string
}

export interface VideoForensicFrame {
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

export interface VideoForensicMetrics {
  totalFramesSampled: number
  facesDetectedCount: number
  averageInterframeDiff: number
  compressionVariance: number
}

export interface EvidenceRelationship {
  source: string
  target: string
  relationship: string
  explanation?: string
  inconsistencyType?: 'lip-sync' | 'transcript-mismatch' | 'video-artifact' | 'audio-manipulation' | 'temporal-splice' | 'general'
}

export interface SuspiciousRegion {
  id: string
  box: [number, number, number, number]
  deepfakeProbability: number
  label: string
  description: string
  confidence: number
}

export interface ForensicAnalysisOutput {
  id: string
  investigationId: string
  reportId: string
  status: 'completed' | 'processing' | 'failed'
  assessment: string
  uncertaintyStatus: 'Potentially Manipulated' | 'No Significant Indicators Detected' | 'Requires Further Review'
  summary: string
  metadata: MediaMetadata
  findings: DetectionIndicator[]
  suspiciousTimestamps: SuspiciousTimestamp[]
  suspiciousRegions?: SuspiciousRegion[]
  evidenceRelationships: EvidenceRelationship[]
  visualizations: Array<{ label: string; url: string }>
  limitations: string[]
  processingErrors: string[]
  createdAt: string
  completedAt?: string
  videoTimeline?: VideoForensicFrame[]
  videoMetrics?: VideoForensicMetrics
}

// Model Interface specifications for external deepfake / synthetic models
export interface DeepfakeModelInterface {
  name: string
  version: string
  isAvailable(): Promise<boolean>
  analyzeFrames(framePaths: string[]): Promise<{
    score?: number
    anomalousFrames: Array<{ frameIndex: number; timestamp: string; score: number; label: string }>
  }>
}

export interface SyntheticVoiceModelInterface {
  name: string
  version: string
  isAvailable(): Promise<boolean>
  analyzeAudio(audioPath: string): Promise<{
    syntheticProbability?: number
    anomalousSegments: Array<{ startSec: number; endSec: number; label: string }>
  }>
}

export interface SpeechTranscriptionService {
  name: string
  isAvailable(): Promise<boolean>
  transcribe(audioPath: string): Promise<Array<{
    start: number
    end: number
    text: string
    speaker?: string
    confidence?: number
  }>>
}
