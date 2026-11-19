import { NextRequest, NextResponse } from 'next/server'
import { cloudStorage } from '@/lib/backend-engine/cloud-storage'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storageKey = searchParams.get('key') || ''
    const exp = searchParams.get('exp') || ''
    const sig = searchParams.get('sig') || ''

    if (!storageKey || !exp || !sig) {
      return NextResponse.json(
        { detail: 'Missing required signature or storage parameters.' },
        { status: 400 }
      )
    }

    const arrayBuffer = await req.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const fileSize = buffer.length

    // Verify HMAC signature
    const isSignatureValid = cloudStorage.verifyDirectUploadSignature(storageKey, exp, sig, fileSize)
    if (!isSignatureValid) {
      return NextResponse.json(
        { detail: 'Invalid or expired upload authorization signature.' },
        { status: 403 }
      )
    }

    // Save staged object safely
    await cloudStorage.saveStagedObject(storageKey, buffer)

    return NextResponse.json(
      {
        status: 'uploaded',
        storageKey,
        size: fileSize,
      },
      { status: 200 }
    )
  } catch (err) {
    return createSafeErrorResponse(err, 'Direct storage upload failed.', 500)
  }
}
