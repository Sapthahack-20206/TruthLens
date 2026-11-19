import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString, sanitizeFilename } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
import { authService } from '@/lib/backend-engine/auth-service'
import { validateAndSaveMediaFile, cleanupTempFiles } from '@/lib/backend-engine/media-processor'
import { analyzeTranscriptEvidence } from '@/lib/backend-engine/transcript-analyzer'
import { investigationStore } from '@/lib/backend-engine/investigation-store'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(req, 'analyze')
  if (rateLimitResponse) return rateLimitResponse

  let savedPath: string | undefined

  try {
    const authContext = authService.getAuthContext(req)
    const { effectiveUserId } = authContext
    const contentType = req.headers.get('content-type') || ''

    let file: File | null = null
    let rawContext = ''
    let referenceText = ''
    let filename = 'evidence_dialogue.wav'

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      file = (formData.get('file') || formData.get('files')) as File | null
      rawContext = (formData.get('context') as string) || ''
      referenceText = (formData.get('referenceText') as string) || ''
      if (file) {
        filename = sanitizeFilename(file.name)
      }
    } else {
      return NextResponse.json(
        { detail: 'Invalid Content-Type. Expected multipart/form-data with media file.' },
        { status: 415 }
      )
    }

    if (!file) {
      return NextResponse.json(
        { detail: 'No media file provided for transcript and speech authenticity analysis.' },
        { status: 400 }
      )
    }

    const context = sanitizeContextString(rawContext)
    const cleanRefText = sanitizeContextString(referenceText)

    // Validate and save file securely
    const validation = await validateAndSaveMediaFile(file, filename)
    savedPath = validation.savedPath

    if (validation.errors.length > 0) {
      return NextResponse.json(
        { detail: `File validation failed: ${validation.errors.join(' ')}` },
        { status: 400 }
      )
    }

    // Execute Deep Transcript Analysis & Speech Authenticity Engine
    const result = await analyzeTranscriptEvidence(savedPath, validation.metadata, cleanRefText, context)

    // Save output & investigation record
    investigationStore.saveOutput(result, effectiveUserId)
    investigationStore.saveRecord({
      id: result.investigationId,
      filename: validation.metadata.filename,
      mediaType: 'audio',
      createdAt: result.createdAt,
      status: 'completed',
      assessment: result.assessment,
      requiresReview: result.uncertaintyStatus !== 'No Significant Indicators Detected',
      reportId: result.reportId,
      userId: effectiveUserId,
      fileSize: validation.metadata.fileSize,
      uncertaintyStatus: result.uncertaintyStatus,
      predictionCategory: result.predictionCategory,
    })

    const response = NextResponse.json(result, { status: 200 })
    return authService.attachGuestCookie(response, authContext)
  } catch (err) {
    return createSafeErrorResponse(
      err,
      'Speech transcription & transcript forensic analysis failed. Please verify media audio stream integrity.',
      500
    )
  } finally {
    if (savedPath) {
      cleanupTempFiles(savedPath)
    }
  }
}
