import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DetectionIndicator, MediaMetadata, SuspiciousRegion } from './types'
import { modelService } from './model-service'
import { ARTIFACTS_TEMP_DIR, cloudStorage } from './cloud-storage'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

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

  // 1. Image Metadata & Software Provenance Inspection
  const rawString = buffer.toString('binary')
  const editingKeywords = ['Adobe Photoshop', 'Photoshop', 'GIMP', 'Lightroom', 'Canva', 'Midjourney', 'Stable Diffusion', 'DALL-E', 'ComfyUI']
  const detectedSoftware: string[] = []

  for (const sw of editingKeywords) {
    if (rawString.includes(sw)) {
      detectedSoftware.push(sw)
    }
  }

  if (detectedSoftware.length > 0) {
    indicators.push({
      id: 'ind-img-software-01',
      category: 'image',
      type: 'Software Provenance Tag',
      title: 'Digital Editing / Generative Software Signature Detected',
      description: `Embedded metadata contains direct markers for software: ${detectedSoftware.join(', ')}. Indicates post-capture modification or synthetic generation pipeline.`,
      severity: 'high',
      confidence: 96,
      isHeuristic: true,
      humanReviewRecommendation: 'Inspect EXIF editing history and quantization table modifications.',
    })
    metadata.software = detectedSoftware.join(', ')
  } else {
    indicators.push({
      id: 'ind-img-software-clean',
      category: 'image',
      type: 'Software Provenance Tag',
      title: 'No Common Editing Software Signature Found',
      description: 'Standard editing software text strings were not detected in file metadata. (Note: Many modern tools strip metadata on export).',
      severity: 'info',
      isHeuristic: true,
      humanReviewRecommendation: 'Check whether metadata was stripped intentionally or if camera quantization tables remain.',
    })
  }

  // 2. Error Level Analysis (ELA) with Python & Pillow
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') {
    try {
      const elaFilename = `ela_${path.basename(imagePath, ext)}.jpg`
      if (!fs.existsSync(ARTIFACTS_TEMP_DIR)) {
        fs.mkdirSync(ARTIFACTS_TEMP_DIR, { recursive: true })
      }
      const elaOutputPath = path.join(ARTIFACTS_TEMP_DIR, elaFilename)

      const pythonScript = `import sys
import os
from PIL import Image, ImageChops, ImageEnhance

src = sys.argv[1]
dst = sys.argv[2]

try:
    im = Image.open(src).convert('RGB')
    temp_resave = dst + '.tmp.jpg'
    im.save(temp_resave, 'JPEG', quality=90)
    resaved = Image.open(temp_resave)
    
    # Calculate difference
    diff = ImageChops.difference(im, resaved)
    
    # Scale difference for visual human inspection
    extrema = diff.getextrema()
    max_diff = max([ex[1] for ex in extrema]) if extrema else 1
    scale = 255.0 / max(max_diff, 1) if max_diff > 0 else 1.0
    scale = min(scale, 15.0) # cap scale
    diff = ImageEnhance.Brightness(diff).enhance(scale)
    
    diff.save(dst, 'JPEG', quality=95)
    if os.path.exists(temp_resave):
        os.remove(temp_resave)
    print("SUCCESS")
except Exception as e:
    print("ERROR:", str(e))
`
      const { stdout } = await execFileAsync('python', ['-c', pythonScript, imagePath, elaOutputPath])
      if (stdout.includes('SUCCESS') && fs.existsSync(elaOutputPath)) {
        try {
          const elaBuffer = fs.readFileSync(elaOutputPath)
          const uploadRes = await cloudStorage.uploadArtifact(elaFilename, elaBuffer, 'image/jpeg')
          visualizations.push({
            label: 'Error Level Analysis (ELA) Compression Map',
            url: uploadRes.url,
          })
        } catch {
          visualizations.push({
            label: 'Error Level Analysis (ELA) Compression Map',
            url: `/forensic-output/${elaFilename}`,
          })
        }

        indicators.push({
          id: 'ind-img-ela-01',
          category: 'image',
          type: 'Error Level Analysis',
          title: 'Error Level Analysis Map Generated',
          description: 'Computed JPEG compression difference map (quality: 90%, 15x contrast enhancement). Regions saved at different compression levels or spliced from another source will appear with distinct brightness levels.',
          severity: 'moderate',
          isHeuristic: true,
          evidenceRef: 'ELA Visualization Map',
          humanReviewRecommendation: 'Examine ELA visualization map: uniformly bright or dark regions are expected; localized bright anomalies indicate potential image splicing or localized digital editing.',
        })
      }
    } catch (err) {
      processingErrors.push(`Error Level Analysis (ELA) generation error: ${err instanceof Error ? err.message : String(err)}`)
      limitations.push('Python Pillow ELA engine could not complete difference rendering.')
    }
  }

  // 3. Neural Deepfake Model Execution (ViT + YuNet)
  try {
    const modelResult = await modelService.analyzeImage(imagePath)
    if (modelResult && modelResult.status === 'success') {
      const isDf = modelResult.deepfakeProbability >= 0.50
      const probPct = (modelResult.deepfakeProbability * 100).toFixed(1)
      const realPct = (modelResult.realProbability * 100).toFixed(1)

      indicators.push({
        id: 'ind-img-vit-deepfake-01',
        category: 'image',
        type: 'Neural Deepfake Classifier',
        title: `Vision Transformer Classifier: ${modelResult.predictedLabel} (${isDf ? probPct : realPct}% confidence)`,
        description: `Neural model (${modelResult.modelName} ${modelResult.modelVersion}) evaluated image representation. Deepfake manipulation probability: ${probPct}%, Authenticity probability: ${realPct}%. ${modelResult.assessment}`,
        confidence: Math.round(modelResult.confidence),
        severity: modelResult.deepfakeProbability >= 0.75 ? 'critical' : modelResult.deepfakeProbability >= 0.50 ? 'high' : 'low',
        isHeuristic: false,
        modelName: `${modelResult.modelName} (${modelResult.modelVersion})`,
        evidenceRef: modelResult.visualizations[0]?.label || 'Neural Latent Representation',
        humanReviewRecommendation: isDf
          ? 'Inspect high-frequency facial boundaries, iris reflections, and texture discontinuities flagged by the neural classifier.'
          : 'Standard neural classification indicates authentic visual features. Absence of detection is not absolute proof.',
      })

      // Add indicators for specific suspicious face regions
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
            humanReviewRecommendation: 'Examine facial border seam against the background lighting for synthetic blending artifacts.',
          })
        }
      }

      // Add visualizations
      if (modelResult.visualizations) {
        visualizations.push(...modelResult.visualizations)
      }

      // Add model limitations
      if (modelResult.limitations) {
        limitations.push(...modelResult.limitations)
      }
    } else {
      limitations.push('Neural deepfake model returned inconclusive inference. Fallback to heuristic and ELA checks.')
      indicators.push({
        id: 'ind-img-model-fallback',
        category: 'image',
        type: 'Model Status',
        title: 'Neural Deepfake Model: Fallback Mode',
        description: 'Deepfake inference engine could not complete full forward pass. Metadata provenance and ELA maps were utilized.',
        severity: 'info',
        isHeuristic: true,
        humanReviewRecommendation: 'Review ELA map and camera quantization metadata manually.',
      })
    }
  } catch (err) {
    processingErrors.push(`Neural deepfake model error: ${err instanceof Error ? err.message : String(err)}`)
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
