import { NextRequest, NextResponse } from 'next/server'
import { logger } from './logger'

export type RateLimitType = 'analyze' | 'upload' | 'auth' | 'read'

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

interface ClientRecord {
  timestamps: number[]
}

const LIMITS: Record<RateLimitType, RateLimitConfig> = {
  analyze: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 30,     // 30 media analysis submissions per minute
  },
  upload: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 20,     // 20 presigned uploads per minute
  },
  auth: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 10,     // 10 authentication attempts per minute (brute-force defense)
  },
  read: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 120,    // 120 status/list requests per minute
  },
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  retryAfterSeconds: number
  isDistributed?: boolean
}

/**
 * Distributed rate limiter with Upstash Redis REST support and in-memory sliding window fallback.
 */
export class RateLimiter {
  private inMemoryStore: Map<string, ClientRecord> = new Map()
  private lastCleanup = Date.now()
  private upstashUrl = process.env.UPSTASH_REDIS_REST_URL || ''
  private upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || ''

  private get hasDistributedStore(): boolean {
    return Boolean(this.upstashUrl && this.upstashToken && this.upstashUrl.startsWith('http'))
  }

  public isDistributed(): boolean {
    return this.hasDistributedStore
  }

  public getClientIp(req: NextRequest): string {
    const forwarded = req.headers.get('x-forwarded-for')
    if (forwarded) {
      const firstIp = forwarded.split(',')[0].trim()
      if (firstIp) return firstIp
    }
    const realIp = req.headers.get('x-real-ip')
    if (realIp) return realIp.trim()
    return '127.0.0.1'
  }

  /**
   * Checks whether the current request is within rate limits.
   * If Upstash Redis is configured, executes atomic distributed rate limit check.
   * Otherwise falls back to in-memory sliding window.
   */
  public async checkLimitAsync(
    clientKey: string,
    type: RateLimitType
  ): Promise<RateLimitResult> {
    const config = LIMITS[type]

    if (this.hasDistributedStore) {
      try {
        const distributedResult = await this.checkUpstashLimit(clientKey, type, config)
        if (distributedResult) return distributedResult
      } catch (err) {
        logger.warn('Distributed rate limit check failed, falling back to local memory', err)
      }
    }

    return this.checkInMemoryLimit(clientKey, type, config)
  }

  /**
   * Synchronous check for backward compatibility with existing synchronous routes.
   */
  public checkLimit(
    clientKey: string,
    type: RateLimitType
  ): RateLimitResult {
    const config = LIMITS[type]
    return this.checkInMemoryLimit(clientKey, type, config)
  }

  private async checkUpstashLimit(
    clientKey: string,
    type: RateLimitType,
    config: RateLimitConfig
  ): Promise<RateLimitResult | null> {
    const now = Date.now()
    const windowSeconds = Math.ceil(config.windowMs / 1000)
    const windowBucket = Math.floor(now / config.windowMs)
    const redisKey = `ratelimit:${type}:${clientKey}:${windowBucket}`

    // Pipeline: INCR and EXPIRE
    const res = await fetch(`${this.upstashUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['EXPIRE', redisKey, windowSeconds * 2],
      ]),
      cache: 'no-store',
    })

    if (!res.ok) return null

    const data = (await res.json()) as Array<{ result?: number }>
    const currentCount = typeof data?.[0]?.result === 'number' ? data[0].result : 1

    const remaining = Math.max(0, config.maxRequests - currentCount)
    const nextWindowMs = (windowBucket + 1) * config.windowMs
    const retryAfterSeconds = Math.max(1, Math.ceil((nextWindowMs - now) / 1000))

    if (currentCount > config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        limit: config.maxRequests,
        retryAfterSeconds,
        isDistributed: true,
      }
    }

    return {
      allowed: true,
      remaining,
      limit: config.maxRequests,
      retryAfterSeconds: 0,
      isDistributed: true,
    }
  }

  private checkInMemoryLimit(
    clientKey: string,
    type: RateLimitType,
    config: RateLimitConfig
  ): RateLimitResult {
    const now = Date.now()
    this.maybeCleanup(now)

    const key = `${type}:${clientKey}`
    const record = this.inMemoryStore.get(key) || { timestamps: [] }

    // Sliding window: retain timestamps within the window
    const windowStart = now - config.windowMs
    const validTimestamps = record.timestamps.filter((ts) => ts > windowStart)

    if (validTimestamps.length >= config.maxRequests) {
      const oldestValid = validTimestamps[0]
      const resetTime = oldestValid + config.windowMs
      const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000))

      return {
        allowed: false,
        remaining: 0,
        limit: config.maxRequests,
        retryAfterSeconds,
        isDistributed: false,
      }
    }

    validTimestamps.push(now)
    this.inMemoryStore.set(key, { timestamps: validTimestamps })

    return {
      allowed: true,
      remaining: config.maxRequests - validTimestamps.length,
      limit: config.maxRequests,
      retryAfterSeconds: 0,
      isDistributed: false,
    }
  }

  private maybeCleanup(now: number) {
    if (now - this.lastCleanup > 3 * 60 * 1000) {
      this.lastCleanup = now
      const maxWindow = Math.max(...Object.values(LIMITS).map((c) => c.windowMs))
      const threshold = now - maxWindow

      for (const [key, record] of this.inMemoryStore.entries()) {
        const fresh = record.timestamps.filter((ts) => ts > threshold)
        if (fresh.length === 0) {
          this.inMemoryStore.delete(key)
        } else {
          this.inMemoryStore.set(key, { timestamps: fresh })
        }
      }
    }
  }
}

export const DistributedRateLimiter = RateLimiter

// Global Singleton Rate Limiter
const globalRateLimiterKey = Symbol.for('truthlens.rateLimiter')
const globalObj = globalThis as unknown as { [key: symbol]: RateLimiter }

if (!globalObj[globalRateLimiterKey]) {
  globalObj[globalRateLimiterKey] = new RateLimiter()
}

export const rateLimiter = globalObj[globalRateLimiterKey]

/**
 * Standard HTTP rate limit enforcement middleware helper for route handlers.
 * Returns null if allowed; returns standard HTTP 429 response if blocked.
 */
export async function enforceRateLimit(
  req: NextRequest,
  type: RateLimitType = 'analyze',
  customKey?: string
): Promise<NextResponse | null> {
  const isProduction = process.env.NODE_ENV === 'production'
  const allowLocalRateLimitFallback = process.env.ALLOW_LOCAL_RATELIMIT_FALLBACK === 'true'

  if (isProduction && !rateLimiter.isDistributed() && !allowLocalRateLimitFallback) {
    logger.error('CRITICAL: Upstash Redis distributed rate limiting is mandatory in production but is not configured.')
    return NextResponse.json(
      {
        error: 'Service Misconfiguration',
        detail: 'Distributed rate limiting is required in production. Please configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN or set ALLOW_LOCAL_RATELIMIT_FALLBACK=true.',
      },
      { status: 503 }
    )
  }

  const ip = rateLimiter.getClientIp(req)
  const key = customKey ? `${ip}:${customKey}` : ip
  const result = await rateLimiter.checkLimitAsync(key, type)

  if (!result.allowed) {
    return NextResponse.json(
      {
        detail: `Rate limit exceeded. Too many requests. Please retry in ${result.retryAfterSeconds} seconds.`,
        retryAfter: result.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.retryAfterSeconds),
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Distributed': String(result.isDistributed ?? false),
        },
      }
    )
  }

  return null
}

export const enforceRateLimitAsync = enforceRateLimit
