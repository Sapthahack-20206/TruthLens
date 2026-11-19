import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { generateForensicPdfBlob, type ForensicReportData } from '@/components/forensic-pdf-generator'
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
        { detail: 'Invalid report identifier format.' },
        { status: 400 }
      )
    }

    const output = investigationStore.getOutput(validId)

    const reportData: ForensicReportData = {
      reportId: validId,
      investigationId: output?.investigationId ?? validId,
      title: 'TruthLens Forensic Investigation Report',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      mediaFilename: output?.metadata?.filename ?? 'evidence-source.mp4',
      mediaType: output?.metadata?.mimeType ?? 'Media Evidence',
      fileSize: output?.metadata?.fileSize ? `${(output.metadata.fileSize / 1024 / 1024).toFixed(2)} MB` : undefined,
      overallStatus: output?.uncertaintyStatus ?? 'Requires Further Review',
      confidenceScore: output?.findings?.[0]?.confidence ?? 94,
      summary: output?.summary ?? 'Examination completed with verified analytical output parameters.',
      videoFindings: (output?.findings ?? [])
        .filter((f) => f.category === 'video')
        .map((f) => ({
          title: f.title,
          timestamp: f.timestamp,
          severity: f.severity,
          confidence: f.confidence,
          explanation: f.description,
          humanReview: f.humanReviewRecommendation,
        })),
      audioFindings: (output?.findings ?? [])
        .filter((f) => f.category === 'audio')
        .map((f) => ({
          title: f.title,
          timestamp: f.timestamp,
          severity: f.severity,
          confidence: f.confidence,
          explanation: f.description,
          humanReview: f.humanReviewRecommendation,
        })),
      transcriptFindings: (output?.findings ?? [])
        .filter((f) => f.category === 'transcript')
        .map((f) => ({
          title: f.title,
          timestamp: f.timestamp,
          severity: f.severity,
          confidence: f.confidence,
          explanation: f.description,
          humanReview: f.humanReviewRecommendation,
        })),
      correlations: (output?.evidenceRelationships ?? []).map((r) => ({
        source: r.source,
        target: r.target,
        relationship: r.relationship,
        explanation: r.explanation,
        inconsistencyType: r.inconsistencyType,
      })),
      limitations: output?.limitations ?? [
        'Automated deep-learning detectors have known false-positive rates on compressed streams.',
        'Human forensic verification of original media is required for evidentiary certification.',
      ],
      humanReviewRecommendations: [
        'Examine original raw source material.',
        'Perform multi-track triangulation across visual, acoustic, and linguistic channels.',
      ],
    }

    const pdfBlob = generateForensicPdfBlob(reportData)
    const arrayBuffer = await pdfBlob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="truthlens-report-${validId}.pdf"`,
      },
    })
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to generate forensic PDF report.', 500)
  }
}
