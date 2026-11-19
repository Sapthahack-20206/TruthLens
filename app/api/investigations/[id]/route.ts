import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { validateIdParam } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
import { authService } from '@/lib/backend-engine/auth-service'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = await enforceRateLimit(req, 'read')
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

    const authContext = await authService.getAuthContextAsync(req)
    const { effectiveUserId } = authContext

    const isBaseline = validId === 'inv-baseline-sample' || validId === 'rep-baseline-001'

    // 1. Asynchronously retrieve record (checks memory cache and queries Supabase PostgreSQL)
    let record = isBaseline
      ? await investigationStore.getRecordAsync(validId)
      : await investigationStore.getRecordAsync(validId, effectiveUserId)

    // 2. If not found under effectiveUserId, check whether it exists globally to accurately return 403 vs 404
    if (!record && !isBaseline) {
      const { databaseService } = await import('@/lib/backend-engine/database')
      const globalRecord = investigationStore.getRawRecord(validId) || (await databaseService.getInvestigation(validId))
      if (globalRecord) {
        if (globalRecord.userId && globalRecord.userId !== effectiveUserId) {
          return NextResponse.json(
            { detail: 'Forbidden: You do not have permission to access this investigation.' },
            { status: 403 }
          )
        }
        record = globalRecord
      }
    }

    if (!record) {
      return NextResponse.json(
        { detail: `Investigation with ID "${validId}" was not found.` },
        { status: 404 }
      )
    }

    // Attach analysis output if available so client can reopen previous analysis results
    const output = await investigationStore.getOutputAsync(validId, effectiveUserId)

    const response = NextResponse.json(
      {
        ...record,
        output: output ?? null,
      },
      { status: 200 }
    )
    return authService.attachGuestCookie(response, authContext)
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to retrieve investigation details.', 500)
  }
}
