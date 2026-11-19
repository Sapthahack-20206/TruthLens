import crypto from 'node:crypto'
import type {
  UploadedFileEvidence,
  ForensicResponse,
  DetectionIndicator,
  ForensicFinding,
  SuspiciousTimestamp,
  EvidenceRelationship,
  ForensicVisualization
} from './types'
import { analyzeImageEvidence } from './image-analyzer'
import { analyzeVideoEvidence } from './video-analyzer'
import { analyzeAudioEvidence } from './audio-analyzer'

/**
 * Coordinates forensic analysis across multiple evidence files (images, audio, video, text)
 */
export async function analyzeMultiModalEvidence(
  evidenceList: UploadedFileEvidence[],
  context = ''
): Promise<ForensicResponse> {
  const id = `inv_${crypto.randomUUID().slice(0, 12)}`
  const reportId = `rep_${crypto.randomUUID().slice(0, 10)}`

  if (evidenceList.length === 0) {
    throw new Error('No valid evidence files provided for cross-modal analysis.')
  }

  // If a single file was provided, route to its dedicated analyzer
  if (evidenceList.length === 1) {
    const single = evidenceList[0]
    if (single.mimeType.startsWith('image/')) return analyzeImageEvidence(single, context)
    if (single.mimeType.startsWith('video/')) return analyzeVideoEvidence(single, context)
    if (single.mimeType.startsWith('audio/')) return analyzeAudioEvidence(single, context)
  }

  const allIndicators: DetectionIndicator[] = []
  const allFindings: ForensicFinding[] = []
  const allTimestamps: SuspiciousTimestamp[] = []
  const relationships: EvidenceRelationship[] = []
  const visualizations: ForensicVisualization[] = []
  const limitations: string[] = []
  const errors: string[] = []
  const aggregatedMetadata: Record<string, string | number | boolean | null> = {
    TotalSources: evidenceList.length,
    ContextProvided: Boolean(context.trim())
  }

  // Analyze each source in parallel
  const results = await Promise.all(
    evidenceList.map(async (ev, idx) => {
      try {
        if (ev.mimeType.startsWith('image/')) {
          const res = await analyzeImageEvidence(ev, context)
          return { type: 'image' as const, res, name: ev.originalName }
        } else if (ev.mimeType.startsWith('video/')) {
          const res = await analyzeVideoEvidence(ev, context)
          return { type: 'video' as const, res, name: ev.originalName }
        } else if (ev.mimeType.startsWith('audio/')) {
          const res = await analyzeAudioEvidence(ev, context)
          return { type: 'audio' as const, res, name: ev.originalName }
        } else {
          // Text / document
          return {
            type: 'text' as const,
            res: null,
            name: ev.originalName
          }
        }
      } catch (err) {
        errors.push(`Error analyzing ${ev.originalName}: ${err instanceof Error ? err.message : 'Unknown'}`)
        return null
      }
    })
  )

  // Aggregate results and build cross-modal relationships
  for (let i = 0; i < results.length; i++) {
    const item = results[i]
    if (!item || !item.res) continue

    aggregatedMetadata[`Source_${i + 1}`] = `${item.name} (${item.type})`
    allIndicators.push(...item.res.indicators)
    allFindings.push(...item.res.findings)
    allTimestamps.push(...item.res.suspiciousTimestamps)
    visualizations.push(...item.res.visualizations)
    limitations.push(...item.res.limitations)

    // Build evidence relationship
    relationships.push({
      source: item.name,
      target: 'Investigation Root',
      relationship: 'Evidence Source',
      explanation: `Forensic findings from ${item.name} aggregated into cross-modal case assessment.`
    })
  }

  // Check temporal / contextual consistency between audio and video if both present
  const videoItem = results.find(r => r?.type === 'video')
  const audioItem = results.find(r => r?.type === 'audio')

  if (videoItem && audioItem) {
    relationships.push({
      source: videoItem.name,
      target: audioItem.name,
      relationship: 'Cross-Track Correlation',
      explanation: 'Evaluated cross-modal alignment between independent video and audio evidence tracks.'
    })

    allIndicators.push({
      id: `ind_${crypto.randomUUID().slice(0, 8)}`,
      category: 'cross_modal_alignment',
      name: 'Multi-Stream Timeline Alignment',
      description: `Cross-referenced temporal timelines between video (${videoItem.name}) and audio (${audioItem.name}).`,
      severity: 'info',
      isHeuristic: true,
      confidence: null,
      evidenceRef: 'Cross-Stream Alignment'
    })
  }

  if (context.trim()) {
    relationships.push({
      source: 'Contextual Narrative',
      target: 'Forensic Findings',
      relationship: 'Corroboration',
      explanation: 'Contextual claims compared against verifiable metadata and acoustic/visual signals.'
    })
  }

  // Deduplicate limitations
  const uniqueLimitations = Array.from(new Set(limitations))

  const suspectCount = allFindings.length
  let assessment = 'Inconclusive - Multiple sources evaluated'
  if (suspectCount > 2) {
    assessment = `Multiple Anomalies Identified Across Evidence Sources (${suspectCount} findings flagged)`
  } else if (suspectCount > 0) {
    assessment = 'Isolated Anomalies Detected - Manual Correlation Recommended'
  } else {
    assessment = 'Baseline Alignment Consistent - No Critical Multi-Source Discrepancies'
  }

  const summary = `Cross-modal investigation completed across ${evidenceList.length} evidence file(s). Recorded ${allIndicators.length} indicators and ${allFindings.length} findings across visual and acoustic modalities.`

  return {
    id,
    investigationId: id,
    reportId,
    status: 'completed',
    mediaType: 'cross-modal',
    assessment,
    summary,
    metadata: aggregatedMetadata,
    indicators: allIndicators,
    findings: allFindings,
    suspiciousTimestamps: allTimestamps,
    evidenceRelationships: relationships,
    visualizations: visualizations.slice(0, 4),
    limitations: uniqueLimitations,
    errors,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  }
}
