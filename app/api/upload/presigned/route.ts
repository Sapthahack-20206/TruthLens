import { NextRequest, NextResponse } from 'next/server'
import { cloudStorage } from '@/lib/backend-engine/cloud-storage'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { authService } from '@/lib/backend-engine/auth-service'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // 1. Rate Limit Upload Presigned Requests (Prevents abuse / DoS)
  const rateLimitResponse = await enforceRateLimit(req, 'upload')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const { effectiveUserId } = authService.getAuthContext(req)

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        { detail: 'Invalid Content-Type header. Expected application/json.' },
        { status: 415 }
      )
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { detail: 'Malformed JSON payload in request body.' },
        { status: 400 }
      )
    }

    const { filename, mimeType, fileSize, category } = body

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json(
        { detail: 'Field "filename" is required and must be a valid string.' },
        { status: 400 }
      )
    }

    if (typeof fileSize !== 'number' || fileSize <= 0) {
      return NextResponse.json(
        { detail: 'Field "fileSize" is required and must be a positive integer representing bytes.' },
        { status: 400 }
      )
    }

    // 2. Validate upload parameters (size, extension, mime)
    const validation = cloudStorage.validateUploadRequest(filename, mimeType || '', fileSize, category)
    if (!validation.isValid) {
      return NextResponse.json(
        { detail: validation.error || 'Upload validation failed.' },
        { status: 400 }
      )
    }

    // 3. Generate presigned upload URL scoped to effectiveUserId
    const presigned = await cloudStorage.generatePresignedUploadUrl({
      filename: validation.safeFilename,
      mimeType: mimeType || 'application/octet-stream',
      fileSize,
      userId: effectiveUserId,
      category,
      expiresInSeconds: 900, // 15 minutes
    })

    return NextResponse.json(presigned, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to generate presigned upload parameters.', 500)
  }
}
