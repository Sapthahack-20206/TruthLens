import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { DetectionIndicator, MediaMetadata } from './types'

const execAsync = promisify(exec)

export interface ImageAnalysisResult {
  indicators: DetectionIndicator[]
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
      // Save directly to public/forensic-output so Next.js can serve it
      const publicOutputDir = path.join(process.cwd(), 'public', 'forensic-output')
      if (!fs.existsSync(publicOutputDir)) {
        fs.mkdirSync(publicOutputDir, { recursive: true })
      }
      const elaOutputPath = path.join(publicOutputDir, elaFilename)

      const pythonScript = `
import sys
from PIL import Image, ImageChops, ImageEnhance

src = r"${imagePath.replace(/\\/g, '\\\\')}"
dst = r"${elaOutputPath.replace(/\\/g, '\\\\')}"

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
    import os
    if os.path.exists(temp_resave):
        os.remove(temp_resave)
    print("SUCCESS")
except Exception as e:
    print("ERROR:", str(e))
`
      const { stdout } = await execAsync(`python -c "${pythonScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`)
      if (stdout.includes('SUCCESS') && fs.existsSync(elaOutputPath)) {
        visualizations.push({
          label: 'Error Level Analysis (ELA) Compression Map',
          url: `/forensic-output/${elaFilename}`,
        })

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

  // 3. Neural Deepfake Model Interface Standby
  indicators.push({
    id: 'ind-img-model-status',
    category: 'image',
    type: 'Model Availability',
    title: 'Image Neural Deepfake Model: Interface Ready / Standby',
    description: 'Structural provenance and ELA compression checks performed. Neural facial blending and diffusion artifact detection models are in standby.',
    severity: 'info',
    isHeuristic: true,
    humanReviewRecommendation: 'Review high-contrast ELA areas and edge gradients around subjects.',
  })

  return {
    indicators,
    visualizations,
    limitations,
    processingErrors,
  }
}
