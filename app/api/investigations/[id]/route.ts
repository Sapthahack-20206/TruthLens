import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { validateIdParam } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

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

    const record = investigationStore.getRecord(validId)

    if (!record) {
      return NextResponse.json(
        { detail: `Investigation with ID "${validId}" was not found.` },
        { status: 404 }
      )
    }

    return NextResponse.json(record, { status: 200 })
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to retrieve investigation details.', 500)
  }
}
