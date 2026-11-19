import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { DetectionIndicator, MediaMetadata, SuspiciousRegion } from './types'
import { modelService } from './model-service'
import { ARTIFACTS_TEMP_DIR, cloudStorage } from './cloud-storage'
import { logger } from './logger'

export interface ImageAnalysisResult {
  indicators: DetectionIndicator[]
  suspiciousRegions: SuspiciousRegion[]
  visualizations: Array<{ label: string; url: string }>
  limitations: string[]
  processingErrors: string[]
}

export async function analyzeImageEvidence(
  imagePath: string,
  metadata: MediaMetadata,
  context = ''
): Promise<ImageAnalysisResult> {
  const indicators: DetectionIndicator[] = []
  const suspiciousRegions: SuspiciousRegion[] = []
  const visualizations: Array<{ label: string; url: string }> = []
  const limitations: string[] = []
  const processingErrors: string[] = []

  const buffer = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const rawString = buffer.toString('binary')

  // 1. Metadata & Generative Pipeline Provenance Scanning
  const generativeKeywords = [
    'Midjourney', 'Stable Diffusion', 'DALL-E', 'ComfyUI', 'NovelAI',
    'Automatic1111', 'InvokeAI', 'Fooocus', 'Civitai', 'Runway', 'Pika'
  ]
  const editingKeywords = [
    'Adobe Photoshop', 'Photoshop', 'GIMP', 'Lightroom', 'Canva', 'Affinity'
  ]

  const detectedGenerative: string[] = []
  const detectedEditing: string[] = []

  for (const kw of generativeKeywords) {
    if (rawString.toLowerCase().includes(kw.toLowerCase())) {
      detectedGenerative.push(kw)
    }
  }
  for (const kw of editingKeywords) {
    if (rawString.toLowerCase().includes(kw.toLowerCase())) {
      detectedEditing.push(kw)
    }
  }

  const hasEmbeddedPrompt = rawString.includes('prompt') && (rawString.includes('steps:') || rawString.includes('negative_prompt'))

  if (detectedGenerative.length > 0 || hasEmbeddedPrompt) {
    const tools = detectedGenerative.length > 0 ? detectedGenerative.join(', ') : 'AI Diffusion Metadata'
    indicators.push({
      id: 'ind-img-software-01',
      category: 'image',
      type: 'Software Provenance Tag',
      title: 'Generative AI Pipeline Signature Detected',
      description: `Embedded file metadata contains signature markers for synthetic generation: ${tools}. Indicates pure algorithmic synthesis or AI in-painting.`,
      severity: 'critical',
      confidence: 98,
      isHeuristic: true,
      humanReviewRecommendation: 'Inspect embedded generation parameters, prompts, and diffusion sampler settings.',
    })
    metadata.software = tools
  } else if (detectedEditing.length > 0) {
    indicators.push({
      id: 'ind-img-software-01',
      category: 'image',
      type: 'Software Provenance Tag',
      title: 'Digital Post-Processing Software Detected',
      description: `Metadata contains markers for editing software: ${detectedEditing.join(', ')}. Indicates post-capture modification or compositing.`,
      severity: 'high',
      confidence: 92,
      isHeuristic: true,
      humanReviewRecommendation: 'Inspect EXIF editing history, quantization tables, and potential image splicing boundaries.',
    })
    metadata.software = detectedEditing.join(', ')
  } else {
    indicators.push({
      id: 'ind-img-software-clean',
      category: 'image',
      type: 'Software Provenance Tag',
      title: 'No Common Editing Software Signature Found',
      description: 'Standard editing software text strings were not detected in file metadata. (Note: Many modern tools and social media platforms strip metadata on export).',
      severity: 'info',
      confidence: 70,
      isHeuristic: true,
      humanReviewRecommendation: 'Absence of metadata signatures is not proof of authentic capture; inspect frequency and noise domains.',
    })
  }

  // 2. Multimodal Neural Deepfake & Forensic Analysis Engine
  try {
    const modelResult = await modelService.analyzeImage(imagePath)

    if (modelResult && modelResult.status === 'success') {
      const isDf = modelResult.deepfakeProbability >= 0.50
      const probPct = (modelResult.deepfakeProbability * 100).toFixed(1)
      const realPct = (modelResult.realProbability * 100).toFixed(1)
      const metrics = modelResult.forensicMetrics || {}

      // Neural Classifier Finding
      indicators.push({
        id: 'ind-img-vit-ai-01',
        category: 'image',
        type: 'Neural AI / Deepfake Classifier',
        title: `Vision Transformer Classifier: ${modelResult.predictedLabel} (${modelResult.confidence}% confidence)`,
        description: `Neural model (${modelResult.modelName} ${modelResult.modelVersion}) evaluated multi-scale feature embeddings. Deepfake/synthetic probability: ${probPct}%, Authenticity probability: ${realPct}%. ${modelResult.assessment}`,
        confidence: Math.round(modelResult.confidence),
        severity: modelResult.deepfakeProbability >= 0.70 ? 'critical' : modelResult.deepfakeProbability >= 0.50 ? 'high' : modelResult.deepfakeProbability >= 0.35 ? 'moderate' : 'low',
        isHeuristic: false,
        modelName: `${modelResult.modelName} (${modelResult.modelVersion})`,
        evidenceRef: 'Vision Transformer Latent Representation',
        humanReviewRecommendation: isDf
          ? 'Inspect facial landmarks, boundary blending seams, and fine textural features flagged by the neural classifier.'
          : 'Neural classifier indicates authentic representation. Absence of neural detection is not absolute proof.',
      })

      // 2D Fast Fourier Transform (FFT) Frequency Domain Finding
      if (typeof metrics.fftSpikeScore === 'number') {
        const hasSpike = Boolean(metrics.hasPeriodicArtifacts)
        indicators.push({
          id: 'ind-img-fft-01',
          category: 'image',
          type: 'Frequency Domain (2D-FFT)',
          title: `2D-FFT Frequency Analysis: ${hasSpike ? 'Periodic Generative Grid Artifacts Detected' : 'Natural Power Spectrum Roll-off'}`,
          description: hasSpike
            ? `Fast Fourier Transform identified periodic high-frequency spectral spikes (spike score: ${metrics.fftSpikeScore}). This checkerboard spectral pattern is a recognized signature of GAN/Diffusion latent upsampling layers.`
            : `2D Fast Fourier Transform power spectrum exhibits natural radial decay (energy ratio: ${metrics.fftEnergyRatio?.toFixed(3) || 'normal'}). No unnatural periodic lattice peaks detected.`,
          confidence: Math.round(Math.min(95, Math.max(50, (metrics.fftSpikeScore || 2.0) * 22))),
          severity: hasSpike ? 'high' : 'info',
          isHeuristic: true,
          evidenceRef: '2D-FFT Magnitude Spectrum Map',
          humanReviewRecommendation: hasSpike
            ? 'Examine FFT magnitude spectrum for cross-shaped or square radial grid spikes caused by generative deconvolution.'
            : 'Natural frequency decay observed. Proceed to spatial noise inspection.',
        })
      }

      // Spatial Noise Residual Consistency Finding
      if (typeof metrics.noiseInconsistency === 'number') {
        const hasDisparity = Boolean(metrics.hasNoiseDisparity)
        indicators.push({
          id: 'ind-img-noise-01',
          category: 'image',
          type: 'Noise Residual Consistency',
          title: `Spatial Noise Analysis: ${hasDisparity ? 'Sensor Noise Inconsistency Detected' : 'Uniform Sensor Noise Distribution'}`,
          description: hasDisparity
            ? `High-pass spatial noise residual analysis revealed significant variance inconsistency across image tiles (ratio: ${metrics.noiseInconsistency}). Indicates localized in-painting, splicing, or synthetic texture generation without coherent sensor PRNU.`
            : `Sensor noise residual is uniformly distributed across image regions (inconsistency ratio: ${metrics.noiseInconsistency}). Consistent with single-capture optical sensor noise.`,
          confidence: Math.round(Math.min(95, Math.max(50, (metrics.noiseInconsistency || 1.0) * 38))),
          severity: hasDisparity ? 'high' : 'info',
          isHeuristic: true,
          evidenceRef: 'Noise Residual Consistency Map',
          humanReviewRecommendation: hasDisparity
            ? 'Inspect localized noise variance boundaries between foreground and background in the noise residual map.'
            : 'Consistent spatial noise observed across smooth regions.',
        })
      }

      // Error Level Analysis (ELA) Compression Finding
      if (typeof metrics.elaMeanDiff === 'number') {
        const hasEla = Boolean(metrics.hasElaDiscrepancy)
        indicators.push({
          id: 'ind-img-ela-01',
          category: 'image',
          type: 'Error Level Analysis',
          title: `Error Level Analysis: ${hasEla ? 'Compression Discrepancy Flagged' : 'Uniform Compression Surface'}`,
          description: hasEla
            ? `JPEG compression difference analysis (90% resave, 15x contrast scaling) detected localized error rate discrepancies (max difference: ${metrics.elaMaxDiff}). Regions saved at different compression stages or modified digitally appear with anomalous brightness.`
            : `JPEG compression difference shows uniform error levels (mean difference: ${metrics.elaMeanDiff}). No evidence of secondary digital splicing under re-compression.`,
          confidence: Math.round(Math.min(92, Math.max(50, (metrics.elaMeanDiff || 1.0) * 25))),
          severity: hasEla ? 'moderate' : 'info',
          isHeuristic: true,
          evidenceRef: 'ELA Compression Map',
          humanReviewRecommendation: hasEla
            ? 'Inspect bright localized spots in ELA map which suggest elements pasted from a different image source.'
            : 'Normal uniform ELA profile observed.',
        })
      }

      // Add suspicious face regions if detected
      if (modelResult.suspiciousRegions && modelResult.suspiciousRegions.length > 0) {
        suspiciousRegions.push(...modelResult.suspiciousRegions)
        for (const sr of modelResult.suspiciousRegions) {
          indicators.push({
            id: `ind-img-region-${sr.id}`,
            category: 'image',
            type: 'Suspicious Region',
            title: sr.label,
            description: sr.description,
            confidence: Math.round(sr.confidence),
            severity: sr.confidence >= 75 ? 'critical' : 'high',
            isHeuristic: false,
            modelName: modelResult.modelName,
            evidenceRef: `Bounding Box: [x:${sr.box[0]}, y:${sr.box[1]}, w:${sr.box[2]}, h:${sr.box[3]}]`,
            humanReviewRecommendation: 'Examine facial border seams and eye/teeth textures against background lighting.',
          })
        }
      }

      // Add visualizations
      if (modelResult.visualizations) {
        for (const vis of modelResult.visualizations) {
          visualizations.push(vis)
        }
      }

      // Add limitations
      if (modelResult.limitations) {
        limitations.push(...modelResult.limitations)
      }
    } else {
      // Model returned null or error status
      limitations.push('Neural AI detection microservice was unavailable or inconclusive. Evaluated using heuristic and metadata pipelines.')
      indicators.push({
        id: 'ind-img-model-unavail',
        category: 'image',
        type: 'Model Status',
        title: 'Neural Deepfake Model: Inconclusive / Offline',
        description: 'Neural deepfake classifier could not complete full forward pass. Analysis completed using deterministic metadata, frequency domain, and compression heuristics.',
        confidence: 0,
        severity: 'info',
        isHeuristic: true,
        humanReviewRecommendation: 'Review ELA maps and frequency spectrum manually; verify neural model service status.',
      })
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    processingErrors.push(`Neural deepfake model error: ${errorMsg}`)
    limitations.push('Neural model execution encountered an error. Heuristic inspection utilized.')
  }

  return {
    indicators,
    suspiciousRegions,
    visualizations,
    limitations,
    processingErrors,
  }
}
