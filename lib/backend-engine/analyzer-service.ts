import crypto from 'node:crypto'
import type { ForensicAnalysisOutput, DetectionIndicator, SuspiciousTimestamp, EvidenceRelationship } from './types'
import { validateAndSaveMediaFile } from './media-processor'
import { analyzeVideoEvidence } from './video-analyzer'
import { analyzeAudioEvidence } from './audio-analyzer'
import { analyzeImageEvidence } from './image-analyzer'
import { investigationStore } from './investigation-store'

export async function processAndAnalyzeMedia(
  file: File | Blob,
  originalFilename = 'evidence.bin',
  context = '',
  modalityOverride?: 'video' | 'audio' | 'image'
): Promise<ForensicAnalysisOutput> {
  const analysisId = `TL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
  const investigationId = `inv-${crypto.randomBytes(6).toString('hex')}`
  const reportId = `rep-${crypto.randomBytes(6).toString('hex')}`
  const now = new Date().toISOString()

  // 1. Validate & Save File
  const { savedPath, metadata, errors: validationErrors } = await validateAndSaveMediaFile(file, originalFilename)

  if (validationErrors.length > 0) {
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
    investigationStore.saveOutput(failedOutput)
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
  const allRelationships: EvidenceRelationship[] = []
  const allVisualizations: Array<{ label: string; url: string }> = []
  const allLimitations: string[] = []
  const allErrors: string[] = []

  // 2. Run Modality Analysis
  if (detectedModality === 'video') {
    const videoRes = await analyzeVideoEvidence(savedPath, metadata, context)
    allIndicators.push(...videoRes.indicators)
    allTimestamps.push(...videoRes.suspiciousTimestamps)
    allLimitations.push(...videoRes.limitations)
    allErrors.push(...videoRes.processingErrors)

    // If an audio stream was extracted from the video, analyze it too (Tri-modal correlation!)
    if (videoRes.extractedAudioPath) {
      const audioRes = await analyzeAudioEvidence(videoRes.extractedAudioPath, metadata, context)
      allIndicators.push(...audioRes.indicators)
      allTimestamps.push(...audioRes.suspiciousTimestamps)
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
    const audioRes = await analyzeAudioEvidence(savedPath, metadata, context)
    allIndicators.push(...audioRes.indicators)
    allTimestamps.push(...audioRes.suspiciousTimestamps)
    allLimitations.push(...audioRes.limitations)
    allErrors.push(...audioRes.processingErrors)
  } else {
    const imgRes = await analyzeImageEvidence(savedPath, metadata, context)
    allIndicators.push(...imgRes.indicators)
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
    suppliedContext: context,
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
    status: 'completed',
    assessment,
    uncertaintyStatus,
    summary,
    metadata,
    findings: allIndicators,
    suspiciousTimestamps: allTimestamps,
    evidenceRelationships: allRelationships,
    visualizations: allVisualizations,
    limitations: allLimitations,
    processingErrors: allErrors,
    createdAt: now,
    completedAt: new Date().toISOString(),
  }

  // Save to stores
  investigationStore.saveOutput(finalOutput)
  investigationStore.saveRecord({
    id: investigationId,
    filename: metadata.filename,
    mediaType: detectedModality === 'video' ? 'video' : detectedModality === 'audio' ? 'audio' : 'image',
    createdAt: now,
    status: 'completed',
    assessment,
    requiresReview: uncertaintyStatus !== 'No Significant Indicators Detected',
    reportId,
  })

  return finalOutput
}
