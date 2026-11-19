/**
 * TruthLens Forensic Analysis Engine - Type Definitions & Contracts
 */

export type MediaType = 'image' | 'video' | 'audio' | 'cross-modal' | 'text'

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'inconclusive'

export type IndicatorCategory = 
  | 'metadata'
  | 'compression'
  | 'error_level_analysis'
  | 'temporal_consistency'
  | 'acoustic_spectral'
  | 'silence_pattern'
  | 'transcription_anomaly'
  | 'ai_model_detection'
  | 'cross_modal_alignment'

export type IndicatorSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

export interface DetectionIndicator {
  id: string
  category: IndicatorCategory
  name: string
  description: string
  severity: IndicatorSeverity
  isHeuristic: boolean
  confidence: number | null // null when ML confidence score is unavailable or purely heuristic
  timestamp?: string // e.g. "00:01.50"
  frameIndex?: number
  evidenceRef?: string
  sourceRef?: string
  details?: Record<string, unknown>
}

export interface SuspiciousTimestamp {
  timestamp: string
  timeSeconds?: number
  frameIndex?: number
  label?: string
  description?: string
  evidenceRef?: string
  severity?: IndicatorSeverity
  frameThumbnailUrl?: string
  indicators?: string[]
}

export interface TimelineSegment {
  startSeconds: number
  endSeconds: number
  startFormatted: string
  endFormatted: string
  status: 'normal' | 'suspicious' | 'flagged'
  suspiciousCount: number
  reasons: string[]
}

export interface SampledFrameInfo {
  frameNumber: number
  timestamp: string
  timeSeconds: number
  facesDetected: number
  hasSuspiciousFeatures: boolean
  flags: string[]
  thumbnailUrl: string
}

export interface ForensicFinding {
  id: string
  type: string
  title: string
  description: string
  timestamp?: string
  evidenceRef?: string
  sourceRef?: string
  confidence?: number | string | null
}

export interface EvidenceRelationship {
  source: string
  target: string
  relationship: string
  explanation?: string
}

export interface ForensicVisualization {
  label: string
  url: string // Safe URL or base64 data URI
  type?: 'ela' | 'spectrum' | 'frame' | 'waveform'
}

export interface MediaMetadata {
  filename: string
  fileSize: number
  mimeType: string
  sha256: string
  format?: string
  dimensions?: { width: number; height: number }
  durationSeconds?: number
  durationFormatted?: string
  frameRate?: number
  frameCount?: number
  videoCodec?: string
  audioCodec?: string
  sampleRate?: number
  audioChannels?: number
  bitRate?: number
  exifTags?: Record<string, string | number | boolean | null>
  softwareSignatures?: string[]
  creationDate?: string
  [key: string]: unknown
}

export interface AnalysisLimitations {
  limitations: string[]
}

export interface ForensicResponse {
  id: string
  investigationId: string
  reportId?: string
  status: AnalysisStatus
  mediaType: MediaType
  assessment: string
  summary: string
  metadata: Record<string, string | number | boolean | null>
  indicators: DetectionIndicator[]
  findings: ForensicFinding[]
  suspiciousTimestamps: SuspiciousTimestamp[]
  evidenceRelationships: EvidenceRelationship[]
  visualizations: ForensicVisualization[]
  timelineSegments?: TimelineSegment[]
  sampledFrames?: SampledFrameInfo[]
  limitations: string[]
  errors: string[]
  createdAt: string
  completedAt?: string
}

export interface InvestigationRecord {
  id: string
  filename: string
  mediaType: MediaType
  createdAt: string
  status: AnalysisStatus
  assessment?: string
  requiresReview?: boolean
  reportId?: string
  fileSize?: number
  sha256?: string
}

export interface UploadedFileEvidence {
  originalName: string
  mimeType: string
  size: number
  tempPath: string
  buffer?: Buffer
  sha256: string
}

/* =========================================================================
   MODEL & SERVICE INTERFACES
   These allow modular plug-and-play integration of real deepfake detection
   models (e.g. Gemini API, HuggingFace, PyTorch/ONNX microservices, Whisper).
   ========================================================================= */

export interface DeepfakeModelResult {
  modelName: string
  modelVersion: string
  isAvailable: boolean
  detectedSynthetic: boolean | null // null if model could not execute or inconclusive
  confidence: number | null // 0.0 to 1.0, null if not evaluated
  reasoning: string
  suspiciousTimestamps?: SuspiciousTimestamp[]
  anomalies?: Array<{ frame?: number; timestamp?: string; description: string; score?: number }>
  rawOutput?: Record<string, unknown>
}

export interface DeepfakeVideoDetectorInterface {
  readonly name: string
  readonly version: string
  isAvailable(): Promise<boolean>
  analyzeVideo(filePath: string, metadata: MediaMetadata, frames?: string[]): Promise<DeepfakeModelResult>
}

export interface DeepfakeAudioDetectorInterface {
  readonly name: string
  readonly version: string
  isAvailable(): Promise<boolean>
  analyzeAudio(filePath: string, metadata: MediaMetadata): Promise<DeepfakeModelResult>
}

export interface DeepfakeImageDetectorInterface {
  readonly name: string
  readonly version: string
  isAvailable(): Promise<boolean>
  analyzeImage(filePath: string, metadata: MediaMetadata, imageBuffer: Buffer): Promise<DeepfakeModelResult>
}

export interface TranscriptionSegment {
  start: number
  end: number
  text: string
  confidence?: number
}

export interface SpeechTranscriptionResult {
  isAvailable: boolean
  engine: string
  fullTranscript: string
  segments: TranscriptionSegment[]
  language?: string
  detectedAnomalies?: string[]
}

export interface SpeechTranscriptionInterface {
  readonly name: string
  isAvailable(): Promise<boolean>
  transcribe(audioFilePath: string): Promise<SpeechTranscriptionResult>
}
