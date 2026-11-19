import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString, sanitizeFilename } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
import { validateAndSaveMediaFile } from '@/lib/backend-engine/media-processor'
import { analyzeAudioEvidence } from '@/lib/backend-engine/audio-analyzer'
import { analyzeImageEvidence } from '@/lib/backend-engine/image-analyzer'
import { executeMultimodalCorrelation } from '@/lib/multimodal-correlation-engine'
import { authService } from '@/lib/backend-engine/auth-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(req, 'analyze')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const authContext = await authService.getAuthContextAsync(req)
    const { effectiveUserId } = authContext

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { detail: 'Invalid Content-Type. Expected multipart/form-data.' },
        { status: 415 }
      )
    }

    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const singleFile = formData.get('file') as File | null
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : []
    const rawContext = (formData.get('context') as string) || ''
    let context = sanitizeContextString(rawContext)

    if (allFiles.length === 0) {
      return NextResponse.json(
        { detail: 'No evidence files provided for cross-modal analysis.' },
        { status: 400 }
      )
    }

    // Limit maximum bundle files to 5 to prevent resource exhaustion
    if (allFiles.length > 5) {
      return NextResponse.json(
        { detail: 'Cross-modal bundle exceeds maximum limit of 5 files per submission.' },
        { status: 400 }
      )
    }

    // Separate text/transcript files from rich media
    const textFiles: File[] = []
    const mediaFiles: File[] = []

    for (const f of allFiles) {
      if (f.type.startsWith('text/') || f.name.toLowerCase().endsWith('.txt')) {
        textFiles.push(f)
      } else {
        mediaFiles.push(f)
      }
    }

    // Ingest text files into investigation context
    for (const tf of textFiles) {
      try {
        const textContent = await tf.text()
        if (textContent.trim()) {
          const safeTxt = sanitizeContextString(textContent)
          context = context.trim()
            ? `${context.trim()}\n\n[Transcript File: ${sanitizeFilename(tf.name)}]\n${safeTxt}`
            : `[Transcript File: ${sanitizeFilename(tf.name)}]\n${safeTxt}`
        }
      } catch {
        // ignore text read failures
      }
    }

    // Select primary file: prioritize video > audio > image > text
    const candidates = mediaFiles.length > 0 ? mediaFiles : allFiles
    candidates.sort((a, b) => {
      const getPrio = (file: File) => {
        const n = file.name.toLowerCase()
        const t = file.type.toLowerCase()
        if (t.startsWith('video/') || n.endsWith('.mp4') || n.endsWith('.mov') || n.endsWith('.webm')) return 1
        if (t.startsWith('audio/') || n.endsWith('.wav') || n.endsWith('.mp3') || n.endsWith('.m4a')) return 2
        if (t.startsWith('image/') || n.endsWith('.jpg') || n.endsWith('.png') || n.endsWith('.webp')) return 3
        return 4
      }
      return getPrio(a) - getPrio(b)
    })

    const primaryFile = candidates[0]
    const primarySafeName = sanitizeFilename(primaryFile.name)
    const primaryResult = await processAndAnalyzeMedia(primaryFile, primarySafeName, context, undefined, effectiveUserId)

    // Process additional secondary media files in the bundle
    if (candidates.length > 1) {
      for (let i = 1; i < candidates.length; i++) {
        const sec = candidates[i]
        const secSafeName = sanitizeFilename(sec.name)
        const secName = sec.name.toLowerCase()

        if (secName.endsWith('.wav') || secName.endsWith('.mp3') || secName.endsWith('.m4a') || sec.type.startsWith('audio/')) {
          const { savedPath, metadata: secMeta, errors } = await validateAndSaveMediaFile(sec, secSafeName)
          if (errors.length === 0) {
            const audioRes = await analyzeAudioEvidence(savedPath, secMeta, context)
            primaryResult.findings.push(...audioRes.indicators)
            primaryResult.suspiciousTimestamps.push(...audioRes.suspiciousTimestamps)
            primaryResult.evidenceRelationships.push({
              source: primarySafeName,
              target: secSafeName,
              relationship: 'Cross-Modal Audio-Visual Binding',
              explanation: `Correlated visual stream (${primarySafeName}) with secondary audio channel (${secSafeName}).`,
              inconsistencyType: 'general',
            })
          }
        } else if (secName.endsWith('.jpg') || secName.endsWith('.jpeg') || secName.endsWith('.png') || secName.endsWith('.webp') || sec.type.startsWith('image/')) {
          const { savedPath, metadata: secMeta, errors } = await validateAndSaveMediaFile(sec, secSafeName)
          if (errors.length === 0) {
            const imgRes = await analyzeImageEvidence(savedPath, secMeta, context)
            primaryResult.findings.push(...imgRes.indicators)
            primaryResult.evidenceRelationships.push({
              source: primarySafeName,
              target: secSafeName,
              relationship: 'Still Frame / Reference Ingestion',
              explanation: `Correlated ${primarySafeName} with reference still image ${secSafeName}.`,
              inconsistencyType: 'general',
            })
          }
        } else {
          primaryResult.evidenceRelationships.push({
            source: primarySafeName,
            target: secSafeName,
            relationship: 'Cross-Modal Bundle Association',
            explanation: `Associated ${primarySafeName} with secondary evidence stream ${secSafeName}.`,
            inconsistencyType: 'general',
          })
        }
      }
    }

    // Record relationship for any transcript files ingested
    for (const tf of textFiles) {
      const tfSafeName = sanitizeFilename(tf.name)
      primaryResult.evidenceRelationships.push({
        source: primarySafeName,
        target: tfSafeName,
        relationship: 'Lexical Transcript Alignment',
        explanation: `Ingested external transcript document (${tfSafeName}) into correlation context.`,
        inconsistencyType: 'transcript-mismatch',
      })
      primaryResult.findings.push({
        id: `ind-txt-${tfSafeName.replace(/[^a-zA-Z0-9]/g, '_')}`,
        category: 'transcript',
        type: 'External Context Alignment',
        title: `Transcript Document Correlated (${tfSafeName})`,
        description: `External transcript document ingested (${tf.size} bytes). Correlated with spoken dialogue cues.`,
        severity: 'info',
        isHeuristic: true,
        humanReviewRecommendation: 'Verify whether dialogue in transcript matches words spoken in audio track.',
      })
    }

    // Run multimodal correlation across the aggregated findings
    const correlationRes = executeMultimodalCorrelation({
      videoFindings: primaryResult.findings.filter((f) => f.category === 'video'),
      audioFindings: primaryResult.findings.filter((f) => f.category === 'audio'),
      imageFindings: primaryResult.findings.filter((f) => f.category === 'image'),
      transcriptFindings: primaryResult.findings.filter((f) => f.category === 'transcript'),
      suspiciousTimestamps: primaryResult.suspiciousTimestamps,
      suppliedContext: context,
      mediaMetadata: primaryResult.metadata,
    })

    for (const cf of correlationRes.combinedFindings) {
      primaryResult.evidenceRelationships.push({
        source: cf.modalitiesInvolved[0]?.toUpperCase() || 'STREAM A',
        target: cf.modalitiesInvolved[1]?.toUpperCase() || 'STREAM B',
        relationship: cf.title,
        explanation: `${cf.explanation} (${cf.whyFlagged})`,
        inconsistencyType: cf.inconsistencyType,
      })
    }

    for (const reason of correlationRes.inconclusiveReasons) {
      if (!primaryResult.limitations.includes(reason)) {
        primaryResult.limitations.push(reason)
      }
    }

    investigationStore.saveOutput(primaryResult, effectiveUserId)

    const response = NextResponse.json(primaryResult, { status: 200 })
    return authService.attachGuestCookie(response, authContext)
  } catch (err) {
    return createSafeErrorResponse(err, 'Cross-modal multimodal analysis failed.', 500)
  }
}
