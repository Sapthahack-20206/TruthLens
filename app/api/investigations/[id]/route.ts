import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { validateIdParam } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
import { authService } from '@/lib/backend-engine/auth-service'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = enforceRateLimit(req, 'read')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const { id } = await params
    const validId = validateIdParam(id)
    if (!validId) {
      return NextResponse.json(
        { detail: 'Invalid investigation identifier format.' },
        { status: 400 }
      )
    }

    const { effectiveUserId } = authService.getAuthContext(req)
    const record = investigationStore.getRecord(validId, effectiveUserId)

    if (!record) {
      return NextResponse.json(
        { detail: `Investigation with ID "${validId}" was not found or access is restricted.` },
        { status: 404 }
      )
    }

    // Attach analysis output if available so client can reopen previous analysis results
    const output = investigationStore.getOutput(validId, effectiveUserId)

    return NextResponse.json(
      {
        ...record,
        output: output ?? null,
      },
      { status: 200 }
    )
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to retrieve investigation details.', 500)
  }
}
