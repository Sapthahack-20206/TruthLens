import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const output = investigationStore.getOutput(id)

    if (!output) {
      // Check if investigation record exists
      const rec = investigationStore.getRecord(id)
      if (rec) {
        return NextResponse.json({
          id: rec.id,
          status: rec.status,
          message: 'Analysis task is recorded.',
        })
      }

      return NextResponse.json(
        { detail: `Analysis task with ID "${id}" was not found.` },
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
    return NextResponse.json(
      { detail: `Status lookup error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
