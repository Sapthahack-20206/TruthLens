/**
 * TruthLens Demonstration Samples & Investigation Guide
 * Provides real pre-packaged evidentiary media for live evaluations.
 */

export interface DemoSamplePreset {
  id: string
  title: string
  subtitle: string
  modality: 'video' | 'audio' | 'image' | 'cross-modal'
  filename: string
  path: string
  mimeType: string
  context: string
  keyFindings: string[]
  recommendedSection: 'video-analysis' | 'audio-analysis' | 'image-analysis' | 'cross-modal'
}

export const DEMO_PRESETS: Record<string, DemoSamplePreset> = {
  video: {
    id: 'demo-video-deepfake',
    title: 'Facial Deepfake Video Benchmark',
    subtitle: '10s, 720p, 24fps interview clip with facial manipulation',
    modality: 'video',
    filename: 'forensic_video_sample.mp4',
    path: '/samples/forensic_video_sample.mp4',
    mimeType: 'video/mp4',
    context: 'Suspected synthetic facial reenactment and boundary blending during press interview.',
    keyFindings: [
      'Facial Boundary Sobel edge gradient seam',
      'High-frequency spectral Laplacian texture disparity (9.6x ratio)',
      '10 keyframes tracked with normalized face bounding boxes',
      'Inter-frame MSE temporal discontinuities',
    ],
    recommendedSection: 'video-analysis',
  },
  audio: {
    id: 'demo-audio-synthetic',
    title: 'Synthesized Voice Acoustic Sample',
    subtitle: 'PCM WAV 16kHz voice recording with acoustic silence gaps',
    modality: 'audio',
    filename: 'forensic_audio_sample.wav',
    path: '/samples/forensic_audio_sample.wav',
    mimeType: 'audio/wav',
    context: 'Acoustic forensic examination: detect voice cloning artifacts and silence gap splices.',
    keyFindings: [
      'Acoustic silence gap drop to 0 amplitude at 00:02.15',
      'Spectral room-tone discontinuity',
      'Pitch contour variance analysis',
    ],
    recommendedSection: 'audio-analysis',
  },
  image: {
    id: 'demo-image-frame',
    title: 'Facial Keyframe Portrait',
    subtitle: 'High-resolution frame for ELA and compression artifact analysis',
    modality: 'image',
    filename: 'forensic_image_sample.jpg',
    path: '/samples/forensic_image_sample.jpg',
    mimeType: 'image/jpeg',
    context: 'Examine facial landmark contours and Error Level Analysis (ELA) compression gradients.',
    keyFindings: [
      'Error Level Analysis (ELA) compression error rate uniformity',
      'EXIF & software signature metadata audit',
      'Facial boundary noise floor inspection',
    ],
    recommendedSection: 'image-analysis',
  },
  transcript: {
    id: 'demo-transcript-benchmark',
    title: 'Dialogue Authenticity Benchmark',
    subtitle: 'Synchronized audio dialogue with speaker verification and reference transcript',
    modality: 'audio',
    filename: 'forensic_audio_sample.wav',
    path: '/samples/forensic_audio_sample.wav',
    mimeType: 'audio/wav',
    context: 'Hello and welcome to TruthLens forensic investigation. In this session, we are analyzing synthetic biometric facial signals and acoustic waveform cues.',
    keyFindings: [
      'Speech transcription alignment with word-level timestamps',
      'Speaker diarization attribution (Speaker 1, Speaker 2)',
      'Lexical Word Error Rate (WER) and Character Error Rate (CER) verification',
      'Dialogue repetition and acoustic boundary splice checks',
    ],
    recommendedSection: 'audio-analysis',
  },
  'cross-modal': {
    id: 'demo-multimodal-case',
    title: 'Tri-Modal Multi-Stream Case Bundle',
    subtitle: 'Synchronized Video + Audio Track + Witness Transcript',
    modality: 'cross-modal',
    filename: 'multimodal_bundle',
    path: '/samples/forensic_video_sample.mp4',
    mimeType: 'video/mp4',
    context: 'Tri-modal verification: align speech timestamps with visual facial movement and spoken text.',
    keyFindings: [
      'Cross-modal phoneme-viseme temporal alignment',
      'Lexical transcript agreement verification',
      'Relational topology graph generation',
    ],
    recommendedSection: 'cross-modal',
  },
}

/**
 * Loads a real demonstration file from the public samples repository as a browser File object.
 */
export async function loadDemoSampleFile(presetId: 'video' | 'audio' | 'image' | 'transcript'): Promise<File> {
  const preset = DEMO_PRESETS[presetId]
  if (!preset) throw new Error(`Unknown preset: ${presetId}`)

  const res = await fetch(preset.path)
  if (!res.ok) {
    throw new Error(`Failed to load demo asset from ${preset.path} (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  return new File([blob], preset.filename, { type: preset.mimeType })
}

/**
 * Loads the complete tri-modal bundle (video + audio + transcript).
 */
export async function loadDemoMultimodalBundle(): Promise<{ files: File[]; context: string }> {
  const [vidRes, audRes, txtRes] = await Promise.all([
    fetch('/samples/forensic_video_sample.mp4'),
    fetch('/samples/forensic_audio_sample.wav'),
    fetch('/samples/forensic_transcript_sample.txt'),
  ])

  const [vidBlob, audBlob, txtBlob] = await Promise.all([
    vidRes.blob(),
    audRes.blob(),
    txtRes.blob(),
  ])

  const files = [
    new File([vidBlob], 'forensic_video_sample.mp4', { type: 'video/mp4' }),
    new File([audBlob], 'forensic_audio_sample.wav', { type: 'audio/wav' }),
    new File([txtBlob], 'forensic_transcript_sample.txt', { type: 'text/plain' }),
  ]

  const context = `[Tri-Modal Investigation Case]
Correlate visual facial motion in 'forensic_video_sample.mp4' with speech acoustic track in 'forensic_audio_sample.wav' and sworn transcript in 'forensic_transcript_sample.txt'. Verify lip-sync timing and room tone continuity.`

  return { files, context }
}
