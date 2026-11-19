/**
 * TruthLens Demonstration Samples & Judge Evaluation Guide
 * Provides real pre-packaged evidentiary media for live hackathon evaluations.
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
export async function loadDemoSampleFile(presetId: 'video' | 'audio' | 'image'): Promise<File> {
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

export interface DemoStep {
  step: number
  title: string
  actionLabel: string
  description: string
  evaluationCriterion: string
}

export const JUDGE_DEMO_STEPS: DemoStep[] = [
  {
    step: 1,
    title: 'The Problem: Weaponized Generative AI & Black-Box Opacity',
    actionLabel: 'Review Problem & Threat Landscape',
    description:
      'Deepfakes, voice clones, and cheap fakes undermine digital truth. Existing detectors output unverified black-box percentages (e.g. "99% Fake") without evidence. TruthLens delivers verifiable, explainable digital forensics.',
    evaluationCriterion: 'Clear real-world problem statement and ethical stance.',
  },
  {
    step: 2,
    title: 'Stage Evidence & Verify Chain of Custody',
    actionLabel: 'Load Benchmark Sample Media',
    description:
      'Upload video, audio, image, or transcript files. TruthLens computes cryptographic SHA-256 hashes immediately to establish tamper-evident chain of custody.',
    evaluationCriterion: 'Robust multi-file staging and cryptographic integrity.',
  },
  {
    step: 3,
    title: 'Transparent Multi-Stage Pipeline Scanning',
    actionLabel: 'Monitor Live Forensic Progress',
    description:
      'Watch real-time analysis progress: header demuxing via FFmpeg, face tracking, spectral Laplacian variance, boundary edge calculation, and acoustic waveform decoding.',
    evaluationCriterion: 'Live feedback, smooth animations, and zero UI lockup.',
  },
  {
    step: 4,
    title: 'Explainable Findings & Heuristic Distinction',
    actionLabel: 'Inspect Forensic Findings',
    description:
      'Review categorized indicators. TruthLens strictly separates heuristic findings (tagged isHeuristic: true) from neural model outputs, with clear plain-English explanations and next steps.',
    evaluationCriterion: 'Honest, verifiable outputs without hallucinated claims.',
  },
  {
    step: 5,
    title: 'Interactive Timeline & Face Bounding Box Preview',
    actionLabel: 'Seek Keyframes & Zoom Frame Modal',
    description:
      'Click any keyframe or suspicious timestamp to seek the video player to that exact millisecond. Click the zoom button to inspect the enlarged frame with face bounding box overlays.',
    evaluationCriterion: 'Deep interactive media player and synchronized playback.',
  },
  {
    step: 6,
    title: 'Tri-Modal Cross-Verification & Relational Topology',
    actionLabel: 'Explore Cross-Modal Correlation',
    description:
      'Connect video, audio, and text into a relational graph. Surface phoneme-viseme lip-sync mismatches and lexical transcript inconsistencies.',
    evaluationCriterion: 'Novel cross-modal correlation architecture.',
  },
  {
    step: 7,
    title: 'Certified Forensic PDF Report Export',
    actionLabel: 'Generate & Download PDF Report',
    description:
      'Produce an official, courtroom-ready forensic report document summarizing metadata, findings, timeline, limitations, and examiner recommendations.',
    evaluationCriterion: 'Complete end-to-end deliverable for real stakeholders.',
  },
]
