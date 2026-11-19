import { NextRequest, NextResponse } from 'next/server'
import { investigationStore } from '@/lib/backend-engine/investigation-store'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const record = investigationStore.getRecord(id)

    if (!record) {
      return NextResponse.json(
        { detail: `Investigation with ID "${id}" was not found.` },
        { status: 404 }
      )
    }

    return NextResponse.json(record, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { detail: `Investigation retrieval error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
