import { NextRequest, NextResponse } from 'next/server'
import { cloudStorage } from '@/lib/backend-engine/cloud-storage'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return NextResponse.json({ detail: 'Invalid forensic asset filename.' }, { status: 400 })
    }

    const artifact = await cloudStorage.getArtifact(filename)
    if (!artifact) {
      return NextResponse.json({ detail: 'Forensic artifact not found.' }, { status: 404 })
    }

    return new NextResponse(artifact.data, {
      status: 200,
      headers: {
        'Content-Type': artifact.contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json(
      { detail: 'Internal error streaming forensic output.' },
      { status: 500 }
    )
  }
}
