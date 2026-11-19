import { NextResponse } from 'next/server'
import os from 'node:os'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { getFfmpegPath } from '@/lib/backend-engine/media-processor'

export const dynamic = 'force-dynamic'

export async function GET() {
  const uptime = process.uptime()
  let ffmpegAvailable = false
  try {
    const ffmpegPath = getFfmpegPath()
    ffmpegAvailable = Boolean(ffmpegPath)
  } catch {
    ffmpegAvailable = false
  }

  let totalRecords = 0
  try {
    totalRecords = investigationStore.listRecords().length
  } catch {
    totalRecords = 0
  }

  return NextResponse.json(
    {
      status: 'healthy',
      service: 'TruthLens Forensic Platform',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(uptime),
      environment: process.env.NODE_ENV || 'production',
      system: {
        platform: os.platform(),
        arch: os.arch(),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      engines: {
        investigationStore: 'active',
        persistedRecords: totalRecords,
        ffmpegBinaryDetected: ffmpegAvailable,
      },
    },
    { status: 200 }
  )
}
