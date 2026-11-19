import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let file: File | null = null
    let context = ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      file = (formData.get('file') || formData.get('files')) as File | null
      context = (formData.get('context') as string) || ''
    } else if (contentType.includes('application/json')) {
      const json = await req.json()
      context = json.context || ''
      // If a URL or base64 was sent
      if (json.fileUrl) {
        return NextResponse.json(
          { detail: 'Direct URL ingestion requires connected storage worker.' },
          { status: 400 }
        )
      }
    }

    if (!file) {
      return NextResponse.json(
        { detail: 'No evidence file provided in the request body.' },
        { status: 400 }
      )
    }

    const result = await processAndAnalyzeMedia(file, file.name, context)

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { detail: `Analysis engine failure: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
