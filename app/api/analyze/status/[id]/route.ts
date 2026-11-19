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
        { detail: 'Invalid task identifier format.' },
        { status: 400 }
      )
    }

    const output = investigationStore.getOutput(validId)

    if (!output) {
      // Check if investigation record exists
      const rec = investigationStore.getRecord(validId)
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
