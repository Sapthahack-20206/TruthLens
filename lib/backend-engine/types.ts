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
  label: string
  description: string
  evidenceRef?: string
  severity?: 'critical' | 'high' | 'moderate' | 'low' | 'info'
}

export interface EvidenceRelationship {
  source: string
  target: string
  relationship: string
  explanation?: string
  inconsistencyType?: 'lip-sync' | 'transcript-mismatch' | 'video-artifact' | 'audio-manipulation' | 'general'
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
  evidenceRelationships: EvidenceRelationship[]
  visualizations: Array<{ label: string; url: string }>
  limitations: string[]
  processingErrors: string[]
  createdAt: string
  completedAt?: string
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
