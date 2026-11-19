import fs from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { DetectionIndicator, MediaMetadata, SuspiciousTimestamp, SyntheticVoiceModelInterface, SpeechTranscriptionService } from './types'

const execAsync = promisify(exec)

// Pluggable Model Registries
const registeredVoiceModels: Map<string, SyntheticVoiceModelInterface> = new Map()
let registeredTranscriptionService: SpeechTranscriptionService | null = null

export function registerSyntheticVoiceModel(model: SyntheticVoiceModelInterface) {
  registeredVoiceModels.set(model.name, model)
}

export function registerTranscriptionService(service: SpeechTranscriptionService) {
  registeredTranscriptionService = service
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

export async function analyzeAudioEvidence(
  audioPath: string,
  metadata: MediaMetadata,
  context = ''
): Promise<{
  indicators: DetectionIndicator[]
  suspiciousTimestamps: SuspiciousTimestamp[]
  transcription?: Array<{ start: number; end: number; text: string; speaker?: string; confidence?: number }>
  limitations: string[]
  processingErrors: string[]
}> {
  const indicators: DetectionIndicator[] = []
  const suspiciousTimestamps: SuspiciousTimestamp[] = []
  const limitations: string[] = []
  const processingErrors: string[] = []

  let transcription: Array<{ start: number; end: number; text: string; speaker?: string; confidence?: number }> | undefined

  // 1. Acoustic Signal Preprocessing & Inspection
  try {
    const buffer = fs.readFileSync(audioPath)

    if (metadata.sampleRate) {
      indicators.push({
        id: 'ind-aud-sample-01',
        category: 'audio',
        type: 'Acoustic Sampling',
        title: `Sample Rate Verified (${(metadata.sampleRate / 1000).toFixed(1)} kHz)`,
        description: `Audio stream utilizes a sampling rate of ${metadata.sampleRate} Hz with ${metadata.channels || 2} channels. Standard forensic spectrum bandwidth up to ${(metadata.sampleRate / 2000).toFixed(1)} kHz Nyquist limit.`,
        severity: 'info',
        isHeuristic: true,
        humanReviewRecommendation: 'Verify whether frequency spectrum cutoff corresponds to standard lossy compression or telephony band-limiting.',
      })
    }

    // Inspect for digital silence or excessive clipping
    if (buffer.length > 1024) {
      let zeroByteCount = 0
      for (let i = 0; i < Math.min(buffer.length, 10000); i++) {
        if (buffer[i] === 0) zeroByteCount++
      }
      const zeroRatio = zeroByteCount / Math.min(buffer.length, 10000)
      if (zeroRatio > 0.45) {
        indicators.push({
          id: 'ind-aud-zeroes-01',
          category: 'audio',
          type: 'Acoustic Continuity',
          title: 'High Ratio of Zero-Value Samples Detected',
          description: `Discontinuous digital silence blocks detected in the initial audio stream (${(zeroRatio * 100).toFixed(1)}% zero samples). May indicate audio splicing or post-processing muting.`,
          severity: 'moderate',
          isHeuristic: true,
          humanReviewRecommendation: 'Inspect audio transitions around silent segments for abrupt phase or background room noise dropouts.',
        })
      }
    }
  } catch (err) {
    processingErrors.push(`Audio preprocessing read error: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Speech Transcription (Whisper Integration Check)
  let whisperRun = false
  if (registeredTranscriptionService) {
    try {
      if (await registeredTranscriptionService.isAvailable()) {
        transcription = await registeredTranscriptionService.transcribe(audioPath)
        whisperRun = true
        indicators.push({
          id: 'ind-aud-transcription-01',
          category: 'transcript',
          type: 'Speech-to-Text Alignment',
          title: `Dialogue Transcribed (${transcription.length} segments)`,
          description: `Extracted speech transcription using ${registeredTranscriptionService.name}.`,
          severity: 'info',
          isHeuristic: false,
          humanReviewRecommendation: 'Compare extracted dialogue timestamps against speaker visual lip movements.',
        })
      }
    } catch (err) {
      processingErrors.push(`Transcription service error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!whisperRun) {
    // Check if Whisper CLI exists on system
    try {
      await execAsync('whisper --help')
      // If Whisper CLI was available, we could run it here.
    } catch {
      limitations.push('Automated speech transcription (Whisper) is not installed in the local environment. Dialogue extraction interface is in standby.')
      indicators.push({
        id: 'ind-aud-whisper-status',
        category: 'transcript',
        type: 'Transcription Service Status',
        title: 'Speech Transcription: Service Standby',
        description: 'No local Whisper or cloud transcription endpoint was detected. TruthLens preserves integrity by not generating synthetic dialog.',
        severity: 'info',
        isHeuristic: true,
        humanReviewRecommendation: 'Upload a reference transcript (.vtt/.srt) or connect the Whisper API service.',
      })
    }
  }

  // 3. Synthetic Voice Detection Models (Pluggable Interface)
  let syntheticModelRun = false
  for (const [name, model] of registeredVoiceModels.entries()) {
    try {
      if (await model.isAvailable()) {
        const res = await model.analyzeAudio(audioPath)
        syntheticModelRun = true
        indicators.push({
          id: `ind-aud-model-${name}`,
          category: 'audio',
          type: 'Synthetic Voice Detector',
          title: `Acoustic Model Analysis (${name} v${model.version})`,
          description: `Voice model evaluated acoustic frequencies. Synthetic voice probability: ${res.syntheticProbability !== undefined ? `${(res.syntheticProbability * 100).toFixed(1)}%` : 'Inconclusive'}.`,
          confidence: res.syntheticProbability !== undefined ? Math.round(res.syntheticProbability * 100) : undefined,
          severity: (res.syntheticProbability ?? 0) > 0.75 ? 'critical' : (res.syntheticProbability ?? 0) > 0.5 ? 'high' : 'low',
          isHeuristic: false,
          modelName: name,
          humanReviewRecommendation: 'Review flagged audio segments for vocoder phase artifacts and breath sound naturalness.',
        })

        for (const seg of res.anomalousSegments) {
          suspiciousTimestamps.push({
            timestamp: formatTime(seg.startSec),
            seconds: seg.startSec,
            label: seg.label,
            description: `Voice synthesis anomaly flagged between ${formatTime(seg.startSec)} and ${formatTime(seg.endSec)}.`,
            evidenceRef: `Segment ${formatTime(seg.startSec)}`,
            severity: 'high',
          })
        }
      }
    } catch (err) {
      processingErrors.push(`Synthetic voice model ${name} error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!syntheticModelRun) {
    limitations.push('Neural synthetic voice (vocoder / voice clone) classifier model is not connected in the local worker.')
    indicators.push({
      id: 'ind-aud-synth-status',
      category: 'audio',
      type: 'Model Availability',
      title: 'Synthetic Voice Classifier: Interface Ready / Standby',
      description: 'Acoustic signal headers and continuity checked. Neural vocoder detection requires connected inference service.',
      severity: 'info',
      isHeuristic: true,
      humanReviewRecommendation: 'Conduct listening tests on uncompressed master recording to detect prosodic flatlines or unnatural phoneme transitions.',
    })
  }

  return {
    indicators,
    suspiciousTimestamps,
    transcription,
    limitations,
    processingErrors,
  }
}
