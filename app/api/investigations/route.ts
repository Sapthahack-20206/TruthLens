import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'

export async function GET() {
  try {
    const list = investigationStore.listRecords()
    return NextResponse.json(list, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { detail: `Failed to retrieve investigations: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const singleFile = formData.get('file') as File | null
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : []
    const context = (formData.get('context') as string) || ''

    if (allFiles.length === 0) {
      return NextResponse.json(
        { detail: 'No evidence files provided to create an investigation.' },
        { status: 400 }
      )
    }

    const primaryFile = allFiles[0]
    const result = await processAndAnalyzeMedia(primaryFile, primaryFile.name, context)

    return NextResponse.json(
      {
        id: result.investigationId,
        status: result.status,
      },
      { status: 201 }
    )
  } catch (err) {
    return NextResponse.json(
      { detail: `Failed to create investigation: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
