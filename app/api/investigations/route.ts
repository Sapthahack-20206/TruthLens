import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString, sanitizeFilename } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

export async function GET(req: NextRequest) {
  const rateLimitResponse = enforceRateLimit(req, 'read')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const list = investigationStore.listRecords()
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to retrieve investigation records.', 500)
  }
}

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
        { detail: 'No evidence files provided to create an investigation.' },
        { status: 400 }
      )
    }

    const context = sanitizeContextString(rawContext)
    const primaryFile = allFiles[0]
    const safeName = sanitizeFilename(primaryFile.name)
    const result = await processAndAnalyzeMedia(primaryFile, safeName, context)

    return NextResponse.json(
      {
        id: result.investigationId,
        status: result.status,
      },
      { status: 201 }
    )
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to create and process investigation.', 500)
  }
}
