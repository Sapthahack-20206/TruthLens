import { NextRequest, NextResponse } from 'next/server'

interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

interface ClientRecord {
  timestamps: number[]
}

const LIMITS: Record<'analyze' | 'read', RateLimitConfig> = {
  analyze: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 30,     // 30 analysis requests per minute per IP
  },
  read: {
    windowMs: 60 * 1000, // 1 minute window
    maxRequests: 120,    // 120 status/list requests per minute per IP
  },
}

class InMemoryRateLimiter {
  private clientStore: Map<string, ClientRecord> = new Map()
  private lastCleanup = Date.now()

  /**
   * Retrieves client IP address from headers safely.
   */
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
   */
  public checkLimit(
    clientIp: string,
    type: 'analyze' | 'read'
  ): {
    allowed: boolean
    remaining: number
    limit: number
    retryAfterSeconds: number
  } {
    const now = Date.now()
    this.maybeCleanup(now)

    const config = LIMITS[type]
    const key = `${type}:${clientIp}`
    const record = this.clientStore.get(key) || { timestamps: [] }

    // Filter timestamps within the current sliding window
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
      }
    }

    validTimestamps.push(now)
    this.clientStore.set(key, { timestamps: validTimestamps })

    return {
      allowed: true,
      remaining: config.maxRequests - validTimestamps.length,
      limit: config.maxRequests,
      retryAfterSeconds: 0,
    }
  }

  private maybeCleanup(now: number) {
    // Clean up every 3 minutes
    if (now - this.lastCleanup > 3 * 60 * 1000) {
      this.lastCleanup = now
      const maxWindow = Math.max(LIMITS.analyze.windowMs, LIMITS.read.windowMs)
      const threshold = now - maxWindow

      for (const [key, record] of this.clientStore.entries()) {
        const fresh = record.timestamps.filter((ts) => ts > threshold)
        if (fresh.length === 0) {
          this.clientStore.delete(key)
        } else {
          this.clientStore.set(key, { timestamps: fresh })
        }
      }
    }
  }
}

// Global Singleton Rate Limiter
const globalRateLimiterKey = Symbol.for('truthlens.rateLimiter')
const globalObj = globalThis as unknown as { [key: symbol]: InMemoryRateLimiter }

if (!globalObj[globalRateLimiterKey]) {
  globalObj[globalRateLimiterKey] = new InMemoryRateLimiter()
}

export const rateLimiter = globalObj[globalRateLimiterKey]

/**
 * Standard HTTP rate limit enforcement middleware helper for route handlers.
 * Returns null if allowed; returns standard HTTP 429 response if blocked.
 */
export function enforceRateLimit(
  req: NextRequest,
  type: 'analyze' | 'read' = 'analyze'
): NextResponse | null {
  const ip = rateLimiter.getClientIp(req)
  const result = rateLimiter.checkLimit(ip, type)

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
        },
      }
    )
  }

  return null
}
