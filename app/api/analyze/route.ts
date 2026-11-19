import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  // 1. Enforce Rate Limiting (Prevents Resource Exhaustion / DoS)
  const rateLimitResponse = enforceRateLimit(req, 'analyze')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const contentType = req.headers.get('content-type') || ''
    let file: File | null = null
    let rawContext = ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      file = (formData.get('file') || formData.get('files')) as File | null
      rawContext = (formData.get('context') as string) || ''
    } else if (contentType.includes('application/json')) {
      const json = await req.json().catch(() => null)
      if (!json || typeof json !== 'object') {
        return NextResponse.json(
          { detail: 'Malformed JSON payload in request body.' },
          { status: 400 }
        )
      }
      rawContext = typeof json.context === 'string' ? json.context : ''
      if (json.fileUrl) {
        return NextResponse.json(
          { detail: 'Direct URL ingestion requires connected storage worker.' },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { detail: 'Unsupported Content-Type header. Expected multipart/form-data.' },
        { status: 415 }
      )
    }

    if (!file) {
      return NextResponse.json(
        { detail: 'No evidence file provided in the request body.' },
        { status: 400 }
      )
    }

    const context = sanitizeContextString(rawContext)
    const result = await processAndAnalyzeMedia(file, file.name, context)

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'The media file could not be analyzed due to processing failure.', 500)
  }
}
