import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
import { authService } from '@/lib/backend-engine/auth-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const rateLimitResponse = enforceRateLimit(req, 'analyze')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const { effectiveUserId } = authService.getAuthContext(req)

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
        { detail: 'No video file provided in the upload request.' },
        { status: 400 }
      )
    }

    const context = sanitizeContextString(rawContext)
    const result = await processAndAnalyzeMedia(file, file.name, context, 'video', effectiveUserId)

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'Video forensic analysis could not be completed. The video stream may be corrupted.', 500)
  }
}
