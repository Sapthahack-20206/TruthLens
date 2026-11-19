import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = (formData.get('file') || formData.get('files')) as File | null
    const context = (formData.get('context') as string) || ''

    if (!file) {
      return NextResponse.json(
        { detail: 'No video file provided in the upload request.' },
        { status: 400 }
      )
    }

    const result = await processAndAnalyzeMedia(file, file.name, context, 'video')

    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { detail: `Video analysis engine error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
