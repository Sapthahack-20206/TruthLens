import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { sanitizeContextString, sanitizeFilename } from '@/lib/backend-engine/security-utils'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'
import { authService } from '@/lib/backend-engine/auth-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(req, 'read')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const authContext = authService.getAuthContext(req)
    const { effectiveUserId } = authContext
    const { searchParams } = new URL(req.url)

    const query = (searchParams.get('search') || '').trim().toLowerCase()
    const mediaType = (searchParams.get('type') || 'all').toLowerCase()
    const statusFilter = (searchParams.get('status') || 'all').toLowerCase()
    const sort = (searchParams.get('sort') || 'newest').toLowerCase()
    const isPaginated = searchParams.get('paginate') === 'true'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)))

    // Fetch user-isolated records (hydrated from Supabase PostgreSQL or local cache)
    let records = await investigationStore.listRecordsAsync(effectiveUserId)

    // Filter by query
    if (query) {
      records = records.filter(
        (r) =>
          r.filename.toLowerCase().includes(query) ||
          r.id.toLowerCase().includes(query) ||
          (r.assessment && r.assessment.toLowerCase().includes(query)) ||
          (r.reportId && r.reportId.toLowerCase().includes(query))
      )
    }

    // Filter by media type
    if (mediaType && mediaType !== 'all') {
      records = records.filter((r) => r.mediaType === mediaType)
    }

    // Filter by status
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'requires-review') {
        records = records.filter((r) => r.requiresReview === true)
      } else if (statusFilter === 'clean') {
        records = records.filter((r) => r.requiresReview === false)
      } else {
        records = records.filter((r) => r.status.toLowerCase() === statusFilter)
      }
    }

    // Sort
    records.sort((a, b) => {
      if (sort === 'oldest') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      if (sort === 'name-asc') {
        return a.filename.localeCompare(b.filename)
      }
      if (sort === 'name-desc') {
        return b.filename.localeCompare(a.filename)
      }
      // default: newest first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    const total = records.length
    const totalPages = Math.ceil(total / limit) || 1

    if (isPaginated) {
      const startIndex = (page - 1) * limit
      const paginatedRecords = records.slice(startIndex, startIndex + limit)
      const stats = investigationStore.getStats(effectiveUserId)

      const response = NextResponse.json(
        {
          records: paginatedRecords,
          total,
          page,
          limit,
          totalPages,
          stats,
        },
        { status: 200 }
      )
      return authService.attachGuestCookie(response, authContext)
    }

    // Standard list for direct consumers
    const response = NextResponse.json(records, { status: 200 })
    return authService.attachGuestCookie(response, authContext)
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to retrieve investigation records.', 500)
  }
}

export async function POST(req: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(req, 'analyze')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const authContext = authService.getAuthContext(req)
    const { effectiveUserId } = authContext

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { detail: 'Invalid Content-Type. Expected multipart/form-data.' },
        { status: 415 }
      )
    }

    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const singleFile = formData.get('file') as File | null
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : []
    const rawContext = (formData.get('context') as string) || ''

    if (allFiles.length === 0) {
      return NextResponse.json(
        { detail: 'No evidence files provided to create an investigation.' },
        { status: 400 }
      )
    }

    const context = sanitizeContextString(rawContext)
    const primaryFile = allFiles[0]
    const safeName = sanitizeFilename(primaryFile.name)
    const result = await processAndAnalyzeMedia(primaryFile, safeName, context, undefined, effectiveUserId)

    const response = NextResponse.json(
      {
        id: result.investigationId,
        status: result.status,
      },
      { status: 201 }
    )
    return authService.attachGuestCookie(response, authContext)
  } catch (err) {
    return createSafeErrorResponse(err, 'Failed to create and process investigation.', 500)
  }
}
