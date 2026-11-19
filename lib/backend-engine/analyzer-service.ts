import crypto from 'node:crypto'
import type { ForensicAnalysisOutput, DetectionIndicator, SuspiciousTimestamp, EvidenceRelationship, SuspiciousRegion } from './types'
import { validateAndSaveMediaFile, cleanupTempFiles } from './media-processor'
import { analyzeVideoEvidence } from './video-analyzer'
import { analyzeAudioEvidence } from './audio-analyzer'
import { analyzeImageEvidence } from './image-analyzer'
import { investigationStore } from './investigation-store'
import { sanitizeContextString } from './security-utils'
import { logger } from './logger'
import { cloudStorage } from './cloud-storage'

export async function processAndAnalyzeMedia(
  file: File | Blob,
  originalFilename = 'evidence.bin',
  context = '',
  modalityOverride?: 'video' | 'audio' | 'image',
  userId?: string
): Promise<ForensicAnalysisOutput> {
  const analysisId = `TL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
  const investigationId = `inv-${crypto.randomBytes(6).toString('hex')}`
  const reportId = `rep-${crypto.randomBytes(6).toString('hex')}`
  const now = new Date().toISOString()
  const cleanContext = sanitizeContextString(context)

  let targetSavedPath: string | undefined
  let extractedAudioTrack: string | undefined

  try {
    // 1. Validate & Save File Securely
    const { savedPath, metadata, errors: validationErrors } = await validateAndSaveMediaFile(file, originalFilename)
    targetSavedPath = savedPath

    if (validationErrors.length > 0) {
      logger.warn(`File validation rejected for ${originalFilename}: ${validationErrors.join(', ')}`)
      const failedOutput: ForensicAnalysisOutput = {
        id: analysisId,
        investigationId,
        reportId,
        status: 'failed',
        assessment: 'Analysis aborted due to validation failure.',
        uncertaintyStatus: 'Inconclusive',
        predictionCategory: 'Inconclusive',
        confidenceScore: 0,
        analyzedFramesCount: 0,
        suspiciousFramesCount: 0,
        summary: `Validation failed: ${validationErrors.join(' ')}`,
        metadata,
        findings: [],
        suspiciousTimestamps: [],
        evidenceRelationships: [],
        visualizations: [],
        limitations: ['File could not be parsed by forensic ingestion pipeline.'],
        processingErrors: validationErrors,
        createdAt: now,
        completedAt: new Date().toISOString(),
      }
      await investigationStore.saveOutputAsync(failedOutput, userId)
      await investigationStore.saveRecordAsync({
        id: investigationId,
        filename: originalFilename,
        mediaType: modalityOverride || 'image',
        createdAt: now,
        status: 'failed',
        assessment: 'Validation failed.',
        requiresReview: true,
        reportId,
        userId,
        uncertaintyStatus: 'Inconclusive',
        predictionCategory: 'Inconclusive',
      })
      return failedOutput
    }

    // Determine Modality
    let detectedModality: 'video' | 'audio' | 'image' = 'image'
    if (modalityOverride) {
      detectedModality = modalityOverride
    } else if (metadata.mimeType.startsWith('video/')) {
      detectedModality = 'video'
    } else if (metadata.mimeType.startsWith('audio/')) {
      detectedModality = 'audio'
    }

    const allIndicators: DetectionIndicator[] = []
    const allTimestamps: SuspiciousTimestamp[] = []
    const allSuspiciousRegions: SuspiciousRegion[] = []
    const allRelationships: EvidenceRelationship[] = []
    const allVisualizations: Array<{ label: string; url: string }> = []
    const allLimitations: string[] = []
    const allErrors: string[] = []
    let videoTimeline: import('./types').VideoForensicFrame[] | undefined
    let videoMetrics: import('./types').VideoForensicMetrics | undefined
    let audioTimeline: import('./types').AudioForensicSegment[] | undefined
    let audioMetrics: import('./types').AudioForensicMetrics | undefined
    let audioDirectStatus: ForensicAnalysisOutput['uncertaintyStatus'] | undefined
    let audioDirectAssessment: string | undefined
    let transcription: import('./types').ForensicTranscriptSegment[] | undefined
    let speakerMetrics: { totalSpeakers: number; speakers: import('./types').SpeakerProfile[] } | undefined
    let transcriptMetrics: import('./types').TranscriptForensicMetrics | undefined

    // 2. Run Modality Analysis
    if (detectedModality === 'video') {
      const videoRes = await analyzeVideoEvidence(savedPath, metadata, cleanContext)
      allIndicators.push(...videoRes.indicators)
      allTimestamps.push(...videoRes.suspiciousTimestamps)
      if (videoRes.visualizations) {
        allVisualizations.push(...videoRes.visualizations)
      }
      allLimitations.push(...videoRes.limitations)
      allErrors.push(...videoRes.processingErrors)
      videoTimeline = videoRes.videoTimeline
      videoMetrics = videoRes.videoMetrics
      if (videoRes.transcription) transcription = videoRes.transcription
      if (videoRes.speakerMetrics) speakerMetrics = videoRes.speakerMetrics
      if (videoRes.transcriptMetrics) transcriptMetrics = videoRes.transcriptMetrics

      // If an audio stream was extracted from the video, analyze it too (Tri-modal correlation!)
      if (videoRes.extractedAudioPath) {
        extractedAudioTrack = videoRes.extractedAudioPath
        const audioRes = await analyzeAudioEvidence(videoRes.extractedAudioPath, metadata, cleanContext)
        allIndicators.push(...audioRes.indicators)
        allTimestamps.push(...audioRes.suspiciousTimestamps)
        if (audioRes.visualizations) {
          allVisualizations.push(...audioRes.visualizations)
        }
        allLimitations.push(...audioRes.limitations)
        allErrors.push(...audioRes.processingErrors)
        audioTimeline = audioRes.audioTimeline
        audioMetrics = audioRes.audioMetrics
        audioDirectStatus = audioRes.uncertaintyStatus
        audioDirectAssessment = audioRes.assessment

        allRelationships.push({
          source: 'Video Stream (Visual)',
          target: 'Extracted Audio Track',
          relationship: 'Temporal Multiplex Alignment',
          explanation: 'Synchronized visual frames with extracted PCM audio stream. Evaluated for viseme/phoneme alignment and acoustic continuity.',
          inconsistencyType: 'general',
        })
      }
    } else if (detectedModality === 'audio') {
      const audioRes = await analyzeAudioEvidence(savedPath, metadata, cleanContext)
      allIndicators.push(...audioRes.indicators)
      allTimestamps.push(...audioRes.suspiciousTimestamps)
      if (audioRes.visualizations) {
        allVisualizations.push(...audioRes.visualizations)
      }
      if (audioRes.transcription) transcription = audioRes.transcription as any
      if (audioRes.speakerMetrics) speakerMetrics = audioRes.speakerMetrics
      if (audioRes.transcriptMetrics) transcriptMetrics = audioRes.transcriptMetrics
      allLimitations.push(...audioRes.limitations)
      allErrors.push(...audioRes.processingErrors)
      audioTimeline = audioRes.audioTimeline
      audioMetrics = audioRes.audioMetrics
      audioDirectStatus = audioRes.uncertaintyStatus
      audioDirectAssessment = audioRes.assessment
    } else {
      const imgRes = await analyzeImageEvidence(savedPath, metadata, cleanContext)
      allIndicators.push(...imgRes.indicators)
      if (imgRes.suspiciousRegions) {
        allSuspiciousRegions.push(...imgRes.suspiciousRegions)
      }
      allVisualizations.push(...imgRes.visualizations)
      allLimitations.push(...imgRes.limitations)
      allErrors.push(...imgRes.processingErrors)
    }

    // 3. Multimodal Correlation Engine Execution
    const { executeMultimodalCorrelation } = await import('@/lib/multimodal-correlation-engine')
    const corrResult = executeMultimodalCorrelation({
      videoFindings: allIndicators.filter((i) => i.category === 'video'),
      audioFindings: allIndicators.filter((i) => i.category === 'audio'),
      imageFindings: allIndicators.filter((i) => i.category === 'image'),
      transcriptFindings: allIndicators.filter((i) => i.category === 'transcript'),
      suspiciousTimestamps: allTimestamps,
      videoTimeline,
      audioTimeline,
      transcription: transcription as any,
      suppliedContext: cleanContext,
      mediaMetadata: metadata,
    })

    // Incorporate combined correlation relationships
    for (const cf of corrResult.combinedFindings) {
      allRelationships.push({
        source: cf.modalitiesInvolved[0]?.toUpperCase() || 'PRIMARY STREAM',
        target: cf.modalitiesInvolved[1]?.toUpperCase() || 'SECONDARY STREAM',
        relationship: cf.title,
        explanation: `${cf.explanation} (${cf.whyFlagged})`,
        inconsistencyType: cf.inconsistencyType,
      })
    }

    // Incorporate inconclusive notices into limitations
    for (const reason of corrResult.inconclusiveReasons) {
      if (!allLimitations.includes(reason)) {
        allLimitations.push(reason)
      }
    }

    // 4. Determine Final Veracity Assessment (Likely AI-Generated | Likely Manipulated | No Significant Indicators Detected | Inconclusive)
    const hasCriticalNeural = allIndicators.some((i) => !i.isHeuristic && (i.severity === 'critical' || (typeof i.confidence === 'number' && i.confidence >= 70)))
    const hasCriticalOrHigh = allIndicators.some((i) => i.severity === 'critical' || i.severity === 'high')
    const hasModerate = allIndicators.some((i) => i.severity === 'moderate')
    const maxDeepfakeScore = videoMetrics?.maxDeepfakeScore ?? 0
    const fusion = corrResult.summary.evidenceFusion

    let uncertaintyStatus: import('./types').UncertaintyStatus = 'Inconclusive'
    let predictionCategory: 'Likely AI-Generated' | 'Likely Manipulated' | 'No Significant Indicators Detected' | 'Inconclusive' = 'Inconclusive'
    let assessment = ''
    let confidenceScore = 0

    if (detectedModality === 'video') {
      if (fusion.contradictionDetected) {
        // Cross-modal contradiction detected (e.g. authentic video face + synthetic cloned voice)
        uncertaintyStatus = 'Likely Manipulated'
        predictionCategory = 'Likely Manipulated'
        confidenceScore = fusion.fusedConfidence
        assessment = `Multimodal contradiction flagged: ${fusion.fusionRationale}`
      } else if (hasCriticalNeural || maxDeepfakeScore >= 0.70) {
        uncertaintyStatus = 'Likely AI-Generated'
        predictionCategory = 'Likely AI-Generated'
        confidenceScore = Math.max(Math.round(maxDeepfakeScore * 100), 85)
        assessment = 'Video exhibits strong neural Vision Transformer deepfake signatures and synthetic facial characteristics. Likely AI-Generated.'
      } else if (fusion.fusedVerdict === 'Likely AI-Generated') {
        uncertaintyStatus = 'Likely AI-Generated'
        predictionCategory = 'Likely AI-Generated'
        confidenceScore = fusion.fusedConfidence
        assessment = fusion.fusionRationale
      } else if (hasCriticalOrHigh || maxDeepfakeScore >= 0.50 || fusion.fusedVerdict === 'Likely Manipulated') {
        uncertaintyStatus = 'Likely Manipulated'
        predictionCategory = 'Likely Manipulated'
        confidenceScore = Math.max(Math.round(maxDeepfakeScore * 100), fusion.fusedConfidence, 72)
        assessment = 'Video exhibits biometric boundary seams, temporal displacement, or cross-modal manipulation indicators. Likely Manipulated.'
      } else if (allErrors.length > 0 || (!videoTimeline || videoTimeline.length < 2)) {
        uncertaintyStatus = 'Inconclusive'
        predictionCategory = 'Inconclusive'
        confidenceScore = 40
        assessment = 'Insufficient forensic frame evidence or stream parsing limits prevent definitive classification. Inconclusive.'
      } else if (hasModerate) {
        uncertaintyStatus = 'Inconclusive'
        predictionCategory = 'Inconclusive'
        confidenceScore = 55
        assessment = 'Low-to-moderate heuristic signals flagged without conclusive neural confirmation. Human examiner verification required.'
      } else {
        uncertaintyStatus = 'No Significant Indicators Detected'
        predictionCategory = 'No Significant Indicators Detected'
        confidenceScore = 12
        assessment = 'No significant structural, biometric, or neural deepfake indicators detected across sampled frames. Note: Absence of detected indicators is not proof of authenticity.'
      }
    } else if (detectedModality === 'audio') {
      if (audioDirectStatus) {
        uncertaintyStatus = audioDirectStatus
      } else if (hasCriticalOrHigh) {
        const isSynthetic = allIndicators.some(
          (i) => i.title.toLowerCase().includes('synthetic') || i.title.toLowerCase().includes('deepfake') || i.title.toLowerCase().includes('cloned') || i.title.toLowerCase().includes('aasist')
        )
        uncertaintyStatus = isSynthetic ? 'Likely AI-Generated Audio' : 'Likely Manipulated Audio'
      } else if (hasModerate) {
        uncertaintyStatus = 'Inconclusive'
      } else {
        uncertaintyStatus = 'No Significant Indicators Detected'
      }

      predictionCategory = (uncertaintyStatus === 'Likely AI-Generated Audio' || uncertaintyStatus === 'Likely AI-Generated')
        ? 'Likely AI-Generated'
        : (uncertaintyStatus === 'Likely Manipulated Audio' || uncertaintyStatus === 'Likely Manipulated')
        ? 'Likely Manipulated'
        : uncertaintyStatus === 'No Significant Indicators Detected'
        ? 'No Significant Indicators Detected'
        : 'Inconclusive'

      confidenceScore = Math.round((audioMetrics?.overallSyntheticProbability ?? 0.5) * 100)
      assessment = (audioDirectAssessment)
        ? audioDirectAssessment
        : generateForensicAssessment(
            uncertaintyStatus,
            detectedModality,
            allIndicators,
            allSuspiciousRegions,
            allTimestamps
          )
    } else if (detectedModality === 'image') {
      const hasAiProvenance = allIndicators.some(
        (i) => i.type === 'Software Provenance Tag' && (i.title.includes('Generative AI') || i.description.includes('synthetic'))
      )
      const hasNeuralSynthetic = allIndicators.some(
        (i) => (i.title.includes('Synthetic') || i.title.includes('Deepfake') || i.title.includes('AI Image Generation')) &&
               (i.severity === 'critical' || i.severity === 'high')
      )
      const hasSpectralAnomalies = allIndicators.some(
        (i) => i.title.includes('2D-FFT') && (i.severity === 'critical' || i.severity === 'high')
      )
      const hasEditingMarkers = allIndicators.some(
        (i) => i.title.includes('Editing Software') || i.title.includes('Error Level Analysis (ELA) Compression Discrepancy')
      )

      if (hasAiProvenance || hasNeuralSynthetic || (hasSpectralAnomalies && allIndicators.some((i) => i.title.includes('Noise Residual')))) {
        uncertaintyStatus = 'Likely AI-Generated'
        predictionCategory = 'Likely AI-Generated'
      } else if (hasCriticalOrHigh || hasEditingMarkers) {
        uncertaintyStatus = 'Likely Manipulated'
        predictionCategory = 'Likely Manipulated'
      } else if (allIndicators.some((i) => i.severity === 'moderate') || allLimitations.length > 2) {
        uncertaintyStatus = 'Inconclusive'
        predictionCategory = 'Inconclusive'
      } else {
        uncertaintyStatus = 'No Significant Indicators Detected'
        predictionCategory = 'No Significant Indicators Detected'
      }

      assessment = generateForensicAssessment(
        uncertaintyStatus,
        detectedModality,
        allIndicators,
        allSuspiciousRegions,
        allTimestamps
      )
    } else {
      if (hasCriticalOrHigh) {
        const isSynthetic = allIndicators.some(
          (i) => i.title.toLowerCase().includes('synthetic') || i.title.toLowerCase().includes('deepfake')
        )
        uncertaintyStatus = isSynthetic ? 'Likely AI-Generated' : 'Potentially Manipulated'
        predictionCategory = isSynthetic ? 'Likely AI-Generated' : 'Likely Manipulated'
      } else if (hasModerate) {
        uncertaintyStatus = 'Requires Further Review'
        predictionCategory = 'Inconclusive'
      } else {
        uncertaintyStatus = 'No Significant Indicators Detected'
        predictionCategory = 'No Significant Indicators Detected'
      }

      assessment = generateForensicAssessment(
        uncertaintyStatus,
        detectedModality,
        allIndicators,
        allSuspiciousRegions,
        allTimestamps
      )
    }

    const analyzedFramesCount = videoMetrics?.totalFramesSampled ?? videoTimeline?.length ?? 0
    const suspiciousFramesCount = videoTimeline?.filter((f) => f.isSuspicious).length ?? allTimestamps.length

    const summary = `Forensic analysis completed on ${metadata.filename} (${metadata.mimeType}, ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB). Found ${allIndicators.length} analysis indicators across ${detectedModality} stream. Overall verdict: ${uncertaintyStatus}. Note: Absence of detected indicators is not proof of authenticity.`

    const finalOutput: ForensicAnalysisOutput = {
      id: analysisId,
      investigationId,
      reportId,
      mediaType: detectedModality === 'video' ? 'video' : detectedModality === 'audio' ? 'audio' : 'image',
      status: 'completed',
      assessment,
      uncertaintyStatus,
      predictionCategory,
      confidenceScore,
      analyzedFramesCount,
      suspiciousFramesCount,
      summary,
      metadata,
      findings: allIndicators,
      suspiciousTimestamps: allTimestamps,
      suspiciousRegions: allSuspiciousRegions,
      evidenceRelationships: allRelationships,
      visualizations: allVisualizations,
      limitations: allLimitations,
      processingErrors: allErrors,
      createdAt: now,
      completedAt: new Date().toISOString(),
      videoTimeline,
      videoMetrics,
      audioTimeline,
      audioMetrics,
      transcription,
      speakerMetrics,
      transcriptMetrics,
    }

    // Save to stores (guaranteed permanent persistence before returning response)
    // 1. Save investigation parent record first so foreign keys in analysis_findings succeed
    await investigationStore.saveRecordAsync({
      id: investigationId,
      filename: metadata.filename,
      mediaType: detectedModality === 'video' ? 'video' : detectedModality === 'audio' ? 'audio' : 'image',
      createdAt: now,
      status: 'completed',
      assessment,
      requiresReview: uncertaintyStatus !== 'No Significant Indicators Detected',
      reportId,
      userId,
      fileSize: metadata.fileSize,
      uncertaintyStatus,
    })

    // 2. Save analysis output payload and relational findings
    await investigationStore.saveOutputAsync(finalOutput, userId)

    return finalOutput
  } finally {
    // Safe guaranteed cleanup of temporary file copies from local sandbox
    cleanupTempFiles(targetSavedPath, extractedAudioTrack)
  }
}

/**
 * Ingests and analyzes media directly from a verified cloud storage reference.
 * Validates ownership, checks binary signatures, stages in /tmp, and purges upon completion.
 */
export async function processAndAnalyzeStorageKey(
  storageKey: string,
  originalFilename: string,
  context = '',
  modalityOverride?: 'video' | 'audio' | 'image',
  userId?: string
): Promise<ForensicAnalysisOutput> {
  // 1. Enforce storage reference ownership
  if (userId && !cloudStorage.verifyStorageKeyOwnership(storageKey, userId)) {
    throw new Error('Access denied: Storage reference does not belong to the authenticated session.')
  }

  // 2. Retrieve object from storage and stage safely in /tmp with magic byte verification
  const { tempPath, buffer } = await cloudStorage.downloadToTempFile(storageKey, originalFilename)

  try {
    const blob = new Blob([buffer])
    const result = await processAndAnalyzeMedia(blob, originalFilename, context, modalityOverride, userId)

    // Link storageKey to investigation record
    if (result.investigationId) {
      const rec = investigationStore.getRecord(result.investigationId, userId)
      if (rec) {
        rec.storageKey = storageKey
        investigationStore.saveRecord(rec)
      }
    }

    return result
  } finally {
    // Clean up temporary staged file from /tmp
    cleanupTempFiles(tempPath)
  }
}

function generateForensicAssessment(
  uncertaintyStatus:
    | 'Likely AI-Generated'
    | 'Likely Manipulated'
    | 'Likely AI-Generated Audio'
    | 'Likely Manipulated Audio'
    | 'No Significant Indicators Detected'
    | 'Inconclusive'
    | 'Potentially Manipulated'
    | 'Requires Further Review',
  modality: 'image' | 'video' | 'audio' | 'cross-modal',
  indicators: DetectionIndicator[],
  suspiciousRegions: SuspiciousRegion[],
  timestamps: SuspiciousTimestamp[]
): string {
  const neuralFinding = indicators.find((i) => !i.isHeuristic && (i.severity === 'critical' || i.severity === 'high'))
  const topCritical = indicators.find((i) => i.severity === 'critical')
  const topHigh = indicators.find((i) => i.severity === 'high')
  const topModerate = indicators.find((i) => i.severity === 'moderate')
  const primaryFinding = neuralFinding || topCritical || topHigh || topModerate || indicators[0]

  if (uncertaintyStatus === 'Likely AI-Generated' || uncertaintyStatus === 'Likely AI-Generated Audio') {
    if (modality === 'image') {
      if (suspiciousRegions.length > 0) {
        const topFace = suspiciousRegions.reduce((prev, curr) => (curr.confidence > prev.confidence ? curr : prev), suspiciousRegions[0])
        return `ViT Deepfake Detection identified synthetic facial generation across ${suspiciousRegions.length} region${suspiciousRegions.length > 1 ? 's' : ''} (confidence: ${topFace.confidence}%). Neural classification indicates synthetic face generation.`
      }
      if (primaryFinding) {
        return `AI Generation signature detected: ${primaryFinding.title}${primaryFinding.confidence ? ` (${primaryFinding.confidence}% confidence)` : ''}. Frequency spectrum or neural latent cues indicate algorithmic image synthesis.`
      }
      return 'Synthetic AI generation signatures identified across neural ViT analysis and spectral domain.'
    }
    if (modality === 'video') {
      return `ViT neural face and frame analysis identified synthetic deepfake generation (${primaryFinding?.title ?? 'Deepfake signatures'}${primaryFinding?.confidence ? `, ${primaryFinding.confidence}% confidence` : ''}).`
    }
    if (modality === 'audio') {
      return `Acoustic neural analysis flagged synthetic speech patterns (${primaryFinding?.title ?? 'Synthetic voice synthesis'}${primaryFinding?.confidence ? `, ${primaryFinding.confidence}% confidence` : ''}).`
    }
    return `Synthetic AI generation markers identified across ${modality} analysis. Primary signal: ${primaryFinding ? primaryFinding.title : 'neural model predictions'}.`
  }

  if (uncertaintyStatus === 'Likely Manipulated' || uncertaintyStatus === 'Likely Manipulated Audio' || uncertaintyStatus === 'Potentially Manipulated') {
    if (modality === 'image') {
      if (suspiciousRegions.length > 0) {
        const topFace = suspiciousRegions.reduce((prev, curr) => (curr.confidence > prev.confidence ? curr : prev), suspiciousRegions[0])
        return `ViT Deepfake Detection flagged ${suspiciousRegions.length} facial region${suspiciousRegions.length > 1 ? 's' : ''} (confidence: ${topFace.confidence}%). Neural classification indicates synthetic face manipulation.`
      }
      if (primaryFinding) {
        return `${primaryFinding.title}${primaryFinding.confidence ? ` (${primaryFinding.confidence}% confidence)` : ''}. Structural frequency or compression artifact anomalies indicate potential image tampering.`
      }
      return 'Potential synthetic manipulation markers detected in image geometry and pixel domain. Human review required.'
    }
    if (modality === 'video') {
      const faceCount = suspiciousRegions.length
      const tsCount = timestamps.length
      if (faceCount > 0 && tsCount > 0) {
        return `ViT face analysis flagged ${faceCount} suspicious facial region${faceCount > 1 ? 's' : ''} across ${tsCount} video segment${tsCount > 1 ? 's' : ''}. Neural deepfake signatures detected across temporal frames.`
      }
      if (primaryFinding) {
        return `${primaryFinding.title}${primaryFinding.confidence ? ` (${primaryFinding.confidence}%)` : ''}. Frame-by-frame forensics detected synthetic inconsistencies.`
      }
      return 'Temporal or facial synthetic anomalies identified across video frames. Forensic examiner review required.'
    }
    if (modality === 'audio') {
      if (primaryFinding) {
        return `${primaryFinding.title}${primaryFinding.confidence ? ` (${primaryFinding.confidence}%)` : ''}. Acoustic spectral and vocoder analysis flagged synthetic vocal patterns.`
      }
      return 'Acoustic spectral distribution anomalies flagged potential synthetic voice generation. Human listening inspection required.'
    }
    return `Potential manipulation indicators detected in ${modality} analysis. Primary factor: ${primaryFinding ? primaryFinding.title : 'multimodal signals'}.`
  }

  if (uncertaintyStatus === 'Inconclusive' || uncertaintyStatus === 'Requires Further Review') {
    if (primaryFinding) {
      return `Inconclusive markers: ${primaryFinding.title}${primaryFinding.confidence ? ` (${primaryFinding.confidence}%)` : ''}. Signals present minor divergence without definitive neural deepfake signature.`
    }
    return `Inconclusive forensic markers flagged across ${modality} stream. Human examiner review recommended.`
  }

  // No Significant Indicators Detected
  if (modality === 'image') {
    if (suspiciousRegions.length > 0) {
      return `ViT model evaluated ${suspiciousRegions.length} facial region${suspiciousRegions.length > 1 ? 's' : ''} with clean authentic scores (< 30% synthetic probability). No manipulation detected.`
    }
    return 'No significant synthetic or algorithmic manipulation detected across pixel, metadata, or frequency domains. Note: Absence of detected indicators does not guarantee authenticity.'
  }
  if (modality === 'video') {
    return 'Temporal frame coherence and facial landmarks maintain natural consistency. No significant synthetic markers detected. Note: Absence of detected indicators does not guarantee authenticity.'
  }
  if (modality === 'audio') {
    return 'Acoustic harmonics, room reverberation, and speech frequency continuum align with natural human vocal track. Note: Absence of detected indicators does not guarantee authenticity.'
  }
  return `No significant structural or heuristic manipulation indicators detected across ${modality} stream. Note: Absence of detected indicators does not guarantee authenticity.`
}

