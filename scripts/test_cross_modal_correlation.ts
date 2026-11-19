/**
 * Test Suite: TruthLens Cross-Modal Evidence Correlation & Multimodal Forensic Intelligence Engine
 * Tests 7 required multimodal correlation and evidence fusion scenarios.
 */

import { executeMultimodalCorrelation, type CorrelationInput } from '../lib/multimodal-correlation-engine'

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`)
    process.exit(1)
  } else {
    console.log(`✅ ${message}`)
  }
}

async function runTests() {
  console.log('======================================================================')
  console.log('TRUTHLENS MULTIMODAL CORRELATION & FORENSIC FUSION TEST SUITE')
  console.log('======================================================================\n')

  // Scenario 1: Video + Audio (Congruent / Authentic baseline)
  console.log('--- SCENARIO 1: Video + Audio (Congruent / Authentic Baseline) ---')
  const scenario1Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'interview_authentic.mp4',
      mimeType: 'video/mp4',
      duration: 12.5,
      channels: 2,
      sampleRate: 48000,
      hashSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    videoFindings: [],
    audioFindings: [],
    videoTimeline: [
      { frameNumber: 0, seconds: 0.5, timestamp: '00:00.50', isSuspicious: false, anomalyCount: 0, faceDetected: true, indicators: [] },
      { frameNumber: 30, seconds: 1.5, timestamp: '00:01.50', isSuspicious: false, anomalyCount: 0, faceDetected: true, indicators: [] },
    ],
    audioTimeline: [
      { startTime: '00:00.50', endTime: '00:01.50', startSec: 0.5, endSec: 1.5, isSuspicious: false, syntheticProbability: 0.08, snrDb: 28.5, spectralFlux: 0.12, spectralFlatness: 0.04, voiceActive: true, label: 'Natural speech' },
    ],
  }
  const res1 = executeMultimodalCorrelation(scenario1Input)
  assert(res1.summary.videoStreamStatus === 'analyzed', 'Scenario 1: Video stream analyzed')
  assert(res1.summary.audioStreamStatus === 'analyzed', 'Scenario 1: Audio stream analyzed')
  assert(res1.summary.lipSyncAssessment === 'no_mismatch_detected', 'Scenario 1: Lip-sync congruent')
  assert(res1.summary.evidenceFusion.fusedVerdict === 'No Significant Indicators Detected', 'Scenario 1: Fused verdict is No Significant Indicators Detected')
  assert(res1.summary.evidenceFusion.contradictionDetected === false, 'Scenario 1: No contradiction detected')
  console.log('Scenario 1 passed.\n')

  // Scenario 2: Video + Audio (Lip-sync mismatch / deepfake dubbing)
  console.log('--- SCENARIO 2: Video + Audio (Lip-Sync Mismatch / Neural Dubbing) ---')
  const scenario2Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'dubbed_speech.mp4',
      mimeType: 'video/mp4',
      duration: 10.0,
      channels: 2,
      sampleRate: 48000,
    },
    videoTimeline: [
      { frameNumber: 15, seconds: 0.5, timestamp: '00:00.50', isSuspicious: true, anomalyCount: 2, faceDetected: true, indicators: ['Mouth boundary warping', 'Viseme distortion'] },
    ],
    audioTimeline: [
      { startTime: '00:00.40', endTime: '00:01.20', startSec: 0.4, endSec: 1.2, isSuspicious: true, syntheticProbability: 0.85, snrDb: 22.0, spectralFlux: 0.45, spectralFlatness: 0.12, voiceActive: true, label: 'Synthetic phoneme onset' },
    ],
    suspiciousTimestamps: [
      { timestamp: '00:00.50', seconds: 0.5, label: 'Mouth boundary warping', description: 'Viseme distortion detected' },
    ],
  }
  const res2 = executeMultimodalCorrelation(scenario2Input)
  assert(res2.summary.lipSyncAssessment === 'potential_mismatch_flagged', 'Scenario 2: Lip-sync mismatch flagged')
  assert(res2.combinedFindings.some((f) => f.inconsistencyType === 'lip-sync'), 'Scenario 2: Lip-sync finding generated')
  assert(res2.summary.evidenceFusion.fusedVerdict === 'Likely Manipulated' || res2.summary.evidenceFusion.fusedVerdict === 'Likely AI-Generated', 'Scenario 2: Fused verdict indicates manipulation')
  console.log('Scenario 2 passed.\n')

  // Scenario 3: Cross-Stream Contradiction (Clean authentic video face + AI-generated cloned voice)
  console.log('--- SCENARIO 3: Cross-Stream Contradiction (Clean Video + Synthetic Audio) ---')
  const scenario3Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'voice_clone_dub.mp4',
      mimeType: 'video/mp4',
      duration: 15.0,
      channels: 1,
      sampleRate: 44100,
    },
    videoFindings: [], // Zero visual anomalies (clean authentic face)
    audioFindings: [
      {
        id: 'aud-aasist-01',
        title: 'AASIST Neural Synthetic Speech Classification (96% Confidence)',
        description: 'Acoustic track exhibits lack of natural vocal fold jitter/shimmer and high-frequency vocoder cutoff at 8 kHz.',
        severity: 'critical',
        confidence: 96,
        isHeuristic: false,
      },
    ],
  }
  const res3 = executeMultimodalCorrelation(scenario3Input)
  assert(res3.summary.evidenceFusion.contradictionDetected === true, 'Scenario 3: Cross-stream contradiction detected!')
  assert(res3.summary.evidenceFusion.fusedVerdict === 'Likely Manipulated', 'Scenario 3: Fused verdict elevated to Likely Manipulated (NOT diluted to authentic average!)')
  assert(res3.summary.evidenceFusion.fusedConfidence >= 90, 'Scenario 3: Fused confidence reflects high synthetic audio confidence')
  assert(res3.summary.evidenceFusion.primaryTriggerModality === 'audio', 'Scenario 3: Primary driver identified as audio')
  console.log('Scenario 3 passed.\n')

  // Scenario 4: Video + Transcript (Dialogue with no visible speaker)
  console.log('--- SCENARIO 4: Video + Transcript (Dialogue with No Visible Speaker) ---')
  const scenario4Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'inserted_speech.mp4',
      mimeType: 'video/mp4',
      duration: 14.0,
      channels: 2,
    },
    transcription: [
      { start: 2.0, end: 5.0, text: 'I hereby confirm that I authorized the financial transfer of two million dollars.', speaker: 'Speaker 1' },
    ],
    videoTimeline: [
      { frameNumber: 60, seconds: 2.5, timestamp: '00:02.50', isSuspicious: false, anomalyCount: 0, faceDetected: false, indicators: [] },
      { frameNumber: 90, seconds: 3.5, timestamp: '00:03.50', isSuspicious: false, anomalyCount: 0, faceDetected: false, indicators: [] },
    ],
  }
  const res4 = executeMultimodalCorrelation(scenario4Input)
  assert(res4.combinedFindings.some((f) => f.inconsistencyType === 'transcript-mismatch'), 'Scenario 4: Flagged dialogue with no visible speaker')
  console.log('Scenario 4 passed.\n')

  // Scenario 5: Audio + Transcript (Speech rate cadence anomaly & lexical divergence)
  console.log('--- SCENARIO 5: Audio + Transcript (Speech Rate Cadence & Lexical Discrepancy) ---')
  const scenario5Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'speech_fast.wav',
      mimeType: 'audio/wav',
      duration: 5.0,
      channels: 1,
      sampleRate: 48000,
    },
    suppliedContext: 'The prime minister announced the immediate resignation of the cabinet members and scheduled elections.',
    transcription: [
      { start: 0.1, end: 2.0, text: 'Hello everyone today is Tuesday and the weather is sunny outside.', speaker: 'Speaker 1' },
    ],
  }
  const res5 = executeMultimodalCorrelation(scenario5Input)
  assert(res5.summary.transcriptComparisonAssessment === 'discrepancy_detected', 'Scenario 5: Lexical discrepancy detected between context and audio speech')
  assert(res5.combinedFindings.some((f) => f.id === 'comb-transcript-context-discrepancy'), 'Scenario 5: Combined finding for transcript discrepancy generated')
  console.log('Scenario 5 passed.\n')

  // Scenario 6: Image + Video (Facial reference divergence)
  console.log('--- SCENARIO 6: Image + Video (Facial Reference Divergence) ---')
  const scenario6Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'bundle_investigation.mp4',
      mimeType: 'video/mp4',
    },
    imageFindings: [
      {
        id: 'img-ref-01',
        title: 'Authentic Photographic Camera Sensor Profile',
        description: 'Natural high-frequency roll-off and PRNU sensor noise. No GAN or diffusion artifacts.',
        severity: 'info',
        confidence: 90,
      },
    ],
    videoFindings: [
      {
        id: 'vid-vit-01',
        title: 'Vision Transformer Neural Face Replacement Detection (94% Confidence)',
        description: 'Biometric boundary seams and abnormal inter-frame flickering around facial margin.',
        severity: 'critical',
        confidence: 94,
      },
    ],
  }
  const res6 = executeMultimodalCorrelation(scenario6Input)
  assert(res6.summary.facialReferenceAssessment === 'divergence_detected', 'Scenario 6: Facial reference divergence detected')
  assert(res6.combinedFindings.some((f) => f.inconsistencyType === 'facial-divergence'), 'Scenario 6: Facial divergence finding generated')
  assert(res6.summary.evidenceFusion.fusedVerdict === 'Likely Manipulated', 'Scenario 6: Fused verdict is Likely Manipulated')
  console.log('Scenario 6 passed.\n')

  // Scenario 7: Single Modality / Missing Streams (Graceful Inconclusive Boundaries)
  console.log('--- SCENARIO 7: Missing Streams (Graceful Inconclusive Handling) ---')
  const scenario7Input: CorrelationInput = {
    mediaMetadata: {
      filename: 'isolated_audio.wav',
      mimeType: 'audio/wav',
    },
    audioFindings: [
      { id: 'aud-01', title: 'Moderate acoustic background noise', description: 'SNR is 18 dB', severity: 'moderate' },
    ],
  }
  const res7 = executeMultimodalCorrelation(scenario7Input)
  assert(res7.summary.videoStreamStatus === 'not_provided', 'Scenario 7: Video correctly marked not_provided')
  assert(res7.summary.lipSyncAssessment === 'inconclusive_insufficient_streams', 'Scenario 7: Lip-sync marked inconclusive due to missing video')
  assert(res7.inconclusiveReasons.length > 0, 'Scenario 7: Inconclusive boundaries explicitly stated')
  assert(res7.standardizedSources.length === 1, 'Scenario 7: Only 1 standardized source created without fabricating missing streams')
  console.log('Scenario 7 passed.\n')

  console.log('======================================================================')
  console.log('ALL 7 MULTIMODAL CORRELATION & FUSION SCENARIOS PASSED SUCCESSFULLY! 🎯')
  console.log('======================================================================')
}

runTests().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
