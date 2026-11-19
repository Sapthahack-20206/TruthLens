import { NextRequest, NextResponse } from 'next/server'
import { processUploadedEvidence } from './media-processor.ts'
import type { UploadedFileEvidence, MediaType, ForensicResponse } from './types'
import { saveForensicResponse } from './investigation-store.ts'

export async function parseFormDataEvidence(
  req: NextRequest,
  expectedType: MediaType
): Promise<{ files: UploadedFileEvidence[]; context: string }> {
  const formData = await req.formData()
  const context = (formData.get('context') as string) || ''
  
  // Extract files from formData (can be under key 'file' or 'files')
  const incomingFiles: File[] = []
  
  const singleFile = formData.get('file')
  if (singleFile && singleFile instanceof File) {
    incomingFiles.push(singleFile)
  }

  const multiFiles = formData.getAll('files')
  for (const item of multiFiles) {
    if (item instanceof File) {
      incomingFiles.push(item)
    }
  }

  if (incomingFiles.length === 0) {
    throw new Error('No file was uploaded in the request (expected "file" or "files" field).')
  }

  const processedEvidence: UploadedFileEvidence[] = []
  for (const f of incomingFiles) {
    // If expectedType is cross-modal, infer individual media type
    let targetType = expectedType
    if (expectedType === 'cross-modal') {
      if (f.type.startsWith('image/')) targetType = 'image'
      else if (f.type.startsWith('video/')) targetType = 'video'
      else if (f.type.startsWith('audio/')) targetType = 'audio'
      else targetType = 'text'
    }

    const ev = await processUploadedEvidence(f, targetType)
    processedEvidence.push(ev)
  }

  return { files: processedEvidence, context }
}

export function handleApiError(err: unknown, defaultMessage: string): NextResponse {
  console.error('[TruthLens Analysis Engine Error]', err)
  const message = err instanceof Error ? err.message : defaultMessage
  return NextResponse.json(
    {
      error: message,
      detail: message,
      status: 'failed'
    },
    { status: 400 }
  )
}

export async function respondWithAnalysis(res: ForensicResponse): Promise<NextResponse> {
  await saveForensicResponse(res)
  return NextResponse.json(res, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0'
    }
  })
}
