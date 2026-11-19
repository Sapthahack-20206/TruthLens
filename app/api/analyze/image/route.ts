import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia, processAndAnalyzeStorageKey } from '@/lib/backend-engine/analyzer-service'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString, sanitizeFilename } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
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
    let file: File | null = null
    let rawContext = ''
    let storageKey = ''
    let filename = 'image_evidence.jpg'

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      file = (formData.get('file') || formData.get('files')) as File | null
      rawContext = (formData.get('context') as string) || ''
      if (file) {
        filename = sanitizeFilename(file.name)
      }
    } else if (contentType.includes('application/json')) {
      const json = await req.json().catch(() => null)
      if (!json || typeof json !== 'object') {
        return NextResponse.json(
          { detail: 'Malformed JSON payload.' },
          { status: 400 }
        )
      }
      rawContext = typeof json.context === 'string' ? json.context : ''
      storageKey = typeof json.storageKey === 'string' ? json.storageKey : ''
      filename = typeof json.filename === 'string' ? sanitizeFilename(json.filename) : 'image_evidence.jpg'

      if (!storageKey) {
        return NextResponse.json(
          { detail: 'Field "storageKey" is required for direct cloud image analysis.' },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { detail: 'Invalid Content-Type. Expected multipart/form-data or application/json.' },
        { status: 415 }
      )
    }

    const context = sanitizeContextString(rawContext)

    // A. Storage Reference Processing
    if (storageKey) {
      const result = await processAndAnalyzeStorageKey(storageKey, filename, context, 'image', effectiveUserId)
      const response = NextResponse.json(result, { status: 200 })
      return authService.attachGuestCookie(response, authContext)
    }

    // B. Direct Multipart Upload
    if (!file) {
      return NextResponse.json(
        { detail: 'No image file provided in the upload request.' },
        { status: 400 }
      )
    }

    const result = await processAndAnalyzeMedia(file, filename, context, 'image', effectiveUserId)
    const response = NextResponse.json(result, { status: 200 })
    return authService.attachGuestCookie(response, authContext)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Access denied')) {
      return NextResponse.json(
        { detail: err.message },
        { status: 403 }
      )
    }
    return createSafeErrorResponse(err, 'Image forensic inspection failed. The image format may be invalid or corrupt.', 500)
  }
}
