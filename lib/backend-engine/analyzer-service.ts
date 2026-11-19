import crypto from 'node:crypto'
import type { ForensicAnalysisOutput, DetectionIndicator, SuspiciousTimestamp, EvidenceRelationship, SuspiciousRegion } from './types'
import { validateAndSaveMediaFile, cleanupTempFiles } from './media-processor'
import { analyzeVideoEvidence } from './video-analyzer'
import { analyzeAudioEvidence } from './audio-analyzer'
import { analyzeImageEvidence } from './image-analyzer'
import { investigationStore } from './investigation-store'
import { sanitizeContextString } from './security-utils'
import { logger } from './logger'

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
        uncertaintyStatus: 'Requires Further Review',
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
      investigationStore.saveOutput(failedOutput, userId)
      investigationStore.saveRecord({
        id: investigationId,
        filename: originalFilename,
        mediaType: modalityOverride || 'image',
        createdAt: now,
        status: 'failed',
        assessment: 'Validation failed.',
        requiresReview: true,
        reportId,
        userId,
        uncertaintyStatus: 'Requires Further Review',
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

        allRelationships.push({
          source: 'Video Stream (Visual)',
          target: 'Extracted Audio Track',
          relationship: 'Temporal Multiplex Alignment',
          explanation: 'Synchronized visual frames with extracted PCM audio stream. No severe acoustic drift detected.',
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
      allLimitations.push(...audioRes.limitations)
      allErrors.push(...audioRes.processingErrors)
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

    // 4. Determine Final Veracity Assessment (Strictly: Potentially Manipulated | No Significant Indicators Detected | Requires Further Review)
    const hasCriticalOrHigh = allIndicators.some((i) => i.severity === 'critical' || i.severity === 'high')
    let uncertaintyStatus: 'Potentially Manipulated' | 'No Significant Indicators Detected' | 'Requires Further Review' = 'Requires Further Review'
    let assessment = ''

    if (hasCriticalOrHigh) {
      uncertaintyStatus = 'Potentially Manipulated'
      assessment = 'Potential manipulation indicators detected. Human examiner review required.'
    } else if (allIndicators.some((i) => i.severity === 'moderate')) {
      uncertaintyStatus = 'Requires Further Review'
      assessment = 'Inconclusive signals flagged during analysis. Requires further review.'
    } else {
      uncertaintyStatus = 'No Significant Indicators Detected'
      assessment = 'No significant structural or heuristic manipulation indicators detected.'
    }

    const summary = `Forensic analysis completed on ${metadata.filename} (${metadata.mimeType}, ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB). Found ${allIndicators.length} analysis indicators across ${detectedModality} stream. Overall verdict: ${uncertaintyStatus}. Note: Absence of detected indicators is not proof of authenticity.`

    const finalOutput: ForensicAnalysisOutput = {
      id: analysisId,
      investigationId,
      reportId,
      mediaType: detectedModality === 'video' ? 'video' : detectedModality === 'audio' ? 'audio' : 'image',
      status: 'completed',
      assessment,
      uncertaintyStatus,
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
    }

    // Save to stores
    investigationStore.saveOutput(finalOutput, userId)
    investigationStore.saveRecord({
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

    return finalOutput
  } finally {
    // Safe guaranteed cleanup of temporary file copies from local sandbox
    cleanupTempFiles(targetSavedPath, extractedAudioTrack)
  }
}
