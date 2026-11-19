import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString, sanitizeFilename } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

export async function POST(req: NextRequest) {
  const rateLimitResponse = enforceRateLimit(req, 'analyze')
  if (rateLimitResponse) return rateLimitResponse

  try {
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

    const context = sanitizeContextString(rawContext)
    const primaryFile = allFiles[0]
    const primarySafeName = sanitizeFilename(primaryFile.name)
    const primaryResult = await processAndAnalyzeMedia(primaryFile, primarySafeName, context)

    // If multiple files (e.g. video + separate audio/transcript file), correlate them
    if (allFiles.length > 1) {
      for (let i = 1; i < allFiles.length; i++) {
        const secondary = allFiles[i]
        const secondarySafeName = sanitizeFilename(secondary.name)
        primaryResult.evidenceRelationships.push({
          source: primarySafeName,
          target: secondarySafeName,
          relationship: 'Cross-Modal Bundle Association',
          explanation: `Associated ${primarySafeName} with secondary context stream ${secondarySafeName} (${secondary.type || 'document'}).`,
          inconsistencyType: 'general',
        })
      }
      investigationStore.saveOutput(primaryResult)
    }

    return NextResponse.json(primaryResult, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'Cross-modal analysis could not be completed.', 500)
  }
}
