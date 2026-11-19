import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString } from '@/lib/backend-engine/security-utils'
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
    const file = (formData.get('file') || formData.get('files')) as File | null
    const rawContext = (formData.get('context') as string) || ''

    if (!file) {
      return NextResponse.json(
        { detail: 'No audio file provided in the upload request.' },
        { status: 400 }
      )
    }

    const context = sanitizeContextString(rawContext)
    const result = await processAndAnalyzeMedia(file, file.name, context, 'audio')

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'Audio forensic analysis could not be completed. The audio container may be corrupted.', 500)
  }
}
