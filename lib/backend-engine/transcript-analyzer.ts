import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn } from 'node:child_process'
import type {
  DetectionIndicator,
  MediaMetadata,
  SuspiciousTimestamp,
  ForensicAnalysisOutput,
  ForensicTranscriptSegment,
  SpeakerProfile,
  TranscriptForensicMetrics,
  SpeechTranscriptionService,
} from './types'

export interface PythonTranscriptOutput {
  status: string
  assessment: string
  uncertaintyStatus: string
  confidenceScore: number
  summary: string
  metadata: Record<string, any>
  transcription: ForensicTranscriptSegment[]
  findings: DetectionIndicator[]
  suspiciousTimestamps: SuspiciousTimestamp[]
  speakerMetrics: {
    totalSpeakers: number
    speakers: SpeakerProfile[]
  }
  transcriptMetrics: TranscriptForensicMetrics
  limitations: string[]
  processingErrors: string[]
}

function resolvePythonScript(): string | null {
  const candidatePaths = [
    path.join(process.cwd(), 'lib', 'backend-engine', 'python-engine', 'transcript_analyzer.py'),
    path.join(__dirname, 'python-engine', 'transcript_analyzer.py'),
    path.join(__dirname, '..', '..', 'lib', 'backend-engine', 'python-engine', 'transcript_analyzer.py'),
    path.join(process.cwd(), 'lib', 'backend-engine', 'transcript_analyzer.py'),
  ]
  return candidatePaths.find((p) => fs.existsSync(p)) || null
}

export function runPythonTranscriptAnalyzer(
  mediaPath: string,
  referenceText?: string,
  modelDir = 'models/whisper-tiny'
): Promise<PythonTranscriptOutput | null> {
  return new Promise((resolve) => {
    const scriptPath = resolvePythonScript()
    if (!scriptPath) {
      console.warn('[TranscriptAnalyzer] transcript_analyzer.py not found')
      resolve(null)
      return
    }

    let tempRefPath: string | null = null
    const args = ['--input', mediaPath, '--model_dir', modelDir]

    if (referenceText && referenceText.trim().length > 0) {
      try {
        tempRefPath = path.join(os.tmpdir(), `tl_ref_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`)
        fs.writeFileSync(tempRefPath, referenceText, 'utf-8')
        args.push('--reference', tempRefPath)
      } catch (e) {
        console.warn('[TranscriptAnalyzer] Failed to write temporary reference file:', e)
      }
    }

    const pyCmd = process.env.PYTHON_PATH || 'python'
    let stdoutData = ''
    let stderrData = ''

    const pyProcess = spawn(
      /*turbopackIgnore: true*/
      pyCmd,
      [scriptPath, ...args],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    const timeout = setTimeout(() => {
      console.warn('[TranscriptAnalyzer] Python transcript process timed out (120s)')
      pyProcess.kill('SIGKILL')
      if (tempRefPath && fs.existsSync(tempRefPath)) {
        try { fs.unlinkSync(tempRefPath) } catch {}
      }
      resolve(null)
    }, 120000)

    pyProcess.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf-8')
    })

    pyProcess.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf-8')
    })

    pyProcess.on('close', (code) => {
      clearTimeout(timeout)
      if (tempRefPath && fs.existsSync(tempRefPath)) {
        try { fs.unlinkSync(tempRefPath) } catch {}
      }

      if (code !== 0) {
        console.warn(`[TranscriptAnalyzer] Python script exited with code ${code}. Stderr: ${stderrData.slice(0, 500)}`)
        // Attempt to parse stdout anyway if JSON was flushed
      }

      try {
        const jsonStart = stdoutData.indexOf('{')
        const jsonEnd = stdoutData.lastIndexOf('}')
        if (jsonStart !== -1 && jsonEnd !== -1) {
          const jsonText = stdoutData.substring(jsonStart, jsonEnd + 1)
          const parsed = JSON.parse(jsonText) as PythonTranscriptOutput
          resolve(parsed)
          return
        }
      } catch (err) {
        console.warn('[TranscriptAnalyzer] Failed to parse Python stdout JSON:', err)
      }

      resolve(null)
    })

    pyProcess.on('error', (err) => {
      clearTimeout(timeout)
      if (tempRefPath && fs.existsSync(tempRefPath)) {
        try { fs.unlinkSync(tempRefPath) } catch {}
      }
      console.warn('[TranscriptAnalyzer] Failed to spawn python process:', err)
      resolve(null)
    })
  })
}

/**
 * Built-in SpeechTranscriptionService implementation using Faster-Whisper
 */
export class TruthLensWhisperService implements SpeechTranscriptionService {
  name = 'TruthLens-Whisper-Tiny-Engine'

  async isAvailable(): Promise<boolean> {
    const scriptPath = resolvePythonScript()
    return Boolean(scriptPath && fs.existsSync(/*turbopackIgnore: true*/ scriptPath))
  }

  async transcribe(audioPath: string): Promise<Array<{
    start: number
    end: number
    text: string
    speaker?: string
    confidence?: number
  }>> {
    const res = await runPythonTranscriptAnalyzer(audioPath)
    if (!res || !res.transcription) return []
    return res.transcription.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      speaker: s.speaker,
      confidence: s.confidence,
    }))
  }
}

/**
 * Full Forensic Transcript & Speech Authenticity Analysis Service
 */
export async function analyzeTranscriptEvidence(
  mediaPath: string,
  metadata: MediaMetadata,
  referenceText?: string,
  context = ''
): Promise<ForensicAnalysisOutput> {
  const investigationId = `INV-${Date.now().toString(36).toUpperCase()}`
  const reportId = `TL-TRN-${Date.now().toString(36).toUpperCase()}`
  const now = new Date().toISOString()

  // Run the deep Python forensic analyzer
  const pyResult = await runPythonTranscriptAnalyzer(mediaPath, referenceText || context)

  if (pyResult && pyResult.status === 'completed') {
    return {
      id: investigationId,
      investigationId,
      reportId,
      mediaType: 'audio',
      status: 'completed',
      assessment: pyResult.assessment,
      uncertaintyStatus: pyResult.uncertaintyStatus as any,
      predictionCategory: pyResult.assessment.includes('Manipulation')
        ? 'Likely Manipulated'
        : pyResult.assessment.includes('Inconsistency')
        ? 'Likely Manipulated'
        : pyResult.assessment.includes('No Significant')
        ? 'No Significant Indicators Detected'
        : 'Inconclusive',
      confidenceScore: pyResult.confidenceScore,
      summary: pyResult.summary,
      metadata: {
        ...metadata,
        ...pyResult.metadata,
        hasAudio: true,
      },
      findings: pyResult.findings,
      suspiciousTimestamps: pyResult.suspiciousTimestamps,
      evidenceRelationships: [],
      visualizations: [],
      transcription: pyResult.transcription,
      speakerMetrics: pyResult.speakerMetrics,
      transcriptMetrics: pyResult.transcriptMetrics,
      limitations: pyResult.limitations,
      processingErrors: pyResult.processingErrors,
      createdAt: now,
      completedAt: new Date().toISOString(),
    }
  }

  // Graceful fallback if python runtime was unavailable
  return {
    id: investigationId,
    investigationId,
    reportId,
    mediaType: 'audio',
    status: 'completed',
    assessment: 'Inconclusive',
    uncertaintyStatus: 'Inconclusive',
    predictionCategory: 'Inconclusive',
    confidenceScore: 50.0,
    summary: 'Automated speech recognition was unable to extract dialogue segments from the media source.',
    metadata: {
      ...metadata,
      hasAudio: false,
    },
    findings: [
      {
        id: 'ind-trn-service-standby',
        category: 'transcript',
        type: 'Transcription Service Standby',
        title: 'Speech Recognition Pipeline Inconclusive',
        description: 'Unable to initialize faster-whisper acoustic model. TruthLens maintains strict forensic standards and will not fabricate synthetic transcripts.',
        severity: 'info',
        isHeuristic: true,
        humanReviewRecommendation: 'Verify media container audio format and ensure local python dependencies are installed.',
      },
    ],
    suspiciousTimestamps: [],
    evidenceRelationships: [],
    visualizations: [],
    transcription: [],
    speakerMetrics: { totalSpeakers: 0, speakers: [] },
    transcriptMetrics: {
      totalWords: 0,
      spokenDurationSec: 0,
      speechRatio: 0,
      wer: null,
      cer: null,
      repetitionCount: 0,
      spliceCount: 0,
      silenceAnomalyCount: 0,
    },
    limitations: [
      'Automated transcript analysis requires an operational acoustic speech-to-text inference runtime.',
    ],
    processingErrors: pyResult?.processingErrors || ['Python transcript analyzer service did not return valid output.'],
    createdAt: now,
    completedAt: new Date().toISOString(),
  }
}
