import { NextResponse } from 'next/server'
import os from 'node:os'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { getFfmpegPath } from '@/lib/backend-engine/media-processor'
import { databaseService } from '@/lib/backend-engine/database'
import { cloudStorage } from '@/lib/backend-engine/cloud-storage'
import { rateLimiter } from '@/lib/backend-engine/rate-limiter'
import { modelService } from '@/lib/backend-engine/model-service'

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

  // Model readiness
  let aiStatus: { available: boolean; vitModel: boolean; yunetModel: boolean; errors: string[] }
  try {
    aiStatus = await modelService.checkModelAvailability()
  } catch {
    aiStatus = { available: false, vitModel: false, yunetModel: false, errors: ['Failed to query model service'] }
  }

  // Database ping
  const dbPing = await databaseService.ping()

  // Storage status
  const storageStatus = cloudStorage.getStatus()

  // Production Readiness Assessment
  const isProd = process.env.NODE_ENV === 'production'
  const allowLocalDb = process.env.ALLOW_LOCAL_PERSISTENCE_FALLBACK === 'true'
  const allowLocalStorage = process.env.ALLOW_LOCAL_STORAGE_FALLBACK === 'true'
  const allowLocalRateLimit = process.env.ALLOW_LOCAL_RATELIMIT_FALLBACK === 'true'
  const allowLocalAi = process.env.ALLOW_LOCAL_AI_FALLBACK === 'true'

  const dbHealthy = databaseService.isReady() || (!isProd || allowLocalDb)
  const storageHealthy = storageStatus.configured || (!isProd || allowLocalStorage)
  const rateLimitHealthy = rateLimiter.isDistributed() || (!isProd || allowLocalRateLimit)
  const aiHealthy = aiStatus.available

  const allHealthy = dbHealthy && storageHealthy && rateLimitHealthy && aiHealthy

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      service: 'TruthLens Forensic Platform',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(uptime),
      environment: process.env.NODE_ENV || 'production',
      readiness: {
        allComponentsReady: allHealthy,
        databaseMandatory: isProd && !allowLocalDb,
        storageMandatory: isProd && !allowLocalStorage,
        rateLimiterMandatory: isProd && !allowLocalRateLimit,
        aiServiceMandatory: isProd && !allowLocalAi,
      },
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
      infrastructure: {
        database: {
          configured: databaseService.isReady(),
          provider: databaseService.isReady() ? 'supabase_postgresql' : 'local_atomic_fallback',
          connected: dbPing.connected,
          latencyMs: dbPing.latencyMs,
          error: dbPing.error,
        },
        cloudStorage: storageStatus,
        rateLimiter: {
          distributed: rateLimiter.isDistributed(),
          provider: rateLimiter.isDistributed() ? 'upstash_redis_rest' : 'in_memory_sliding_window',
        },
        aiInference: {
          available: aiStatus.available,
          vitModel: aiStatus.vitModel,
          yunetModel: aiStatus.yunetModel,
          errors: aiStatus.errors,
        },
      },
    },
    { status: 200 }
  )
}
