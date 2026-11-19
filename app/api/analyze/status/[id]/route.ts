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
        { detail: 'Invalid task identifier format.' },
        { status: 400 }
      )
    }

    const { effectiveUserId } = authService.getAuthContext(req)
    const isBaseline = validId === 'TL-BASELINE-SAMPLE' || validId === 'inv-baseline-sample' || validId === 'rep-baseline-001'

    // Check existence
    const unverifiedOutput = investigationStore.getOutput(validId)
    const unverifiedRecord = investigationStore.getRecord(validId)

    if (!unverifiedOutput && !unverifiedRecord && !isBaseline) {
      return NextResponse.json(
        { detail: `Analysis task with ID "${validId}" was not found.` },
        { status: 404 }
      )
    }

    // Ownership check
    const ownerUserId = (unverifiedOutput as unknown as { userId?: string })?.userId || unverifiedRecord?.userId
    if (ownerUserId && !isBaseline && ownerUserId !== effectiveUserId) {
      return NextResponse.json(
        { detail: 'Forbidden: You do not have permission to view status for this task.' },
        { status: 403 }
      )
    }

    const output = isBaseline ? unverifiedOutput : investigationStore.getOutput(validId, effectiveUserId)
    const rec = isBaseline ? unverifiedRecord : investigationStore.getRecord(validId, effectiveUserId)

    if (!output) {
      if (rec) {
        return NextResponse.json({
          id: rec.id,
          status: rec.status,
          message: 'Analysis task is recorded.',
        })
      }

      return NextResponse.json(
        { detail: `Analysis task with ID "${validId}" was not found.` },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: output.id,
      investigationId: output.investigationId,
      reportId: output.reportId,
      status: output.status,
      assessment: output.assessment,
      uncertaintyStatus: output.uncertaintyStatus,
      summary: output.summary,
      metadata: output.metadata,
      findings: output.findings,
      suspiciousTimestamps: output.suspiciousTimestamps,
      evidenceRelationships: output.evidenceRelationships,
      visualizations: output.visualizations,
      limitations: output.limitations,
      processingErrors: output.processingErrors,
      createdAt: output.createdAt,
      completedAt: output.completedAt,
    })
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to retrieve analysis status.', 500)
  }
}
