import { NextResponse } from 'next/server'

type LogLevel = 'info' | 'warn' | 'error' | 'security'

const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-.]+/gi,
  /authorization:\s*['"]?[^'"]+['"]?/gi,
  /password["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
  /api[_-]?key["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
  /secret["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
  /token["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
]

function sanitizeLogMessage(message: string): string {
  let cleaned = message
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[REDACTED_CREDENTIAL]')
  }
  // Mask local Windows/Unix absolute file paths to protect filesystem structure
  cleaned = cleaned.replace(/[A-Za-z]:\\[^"'\n\r\t<>]+/g, '[REDACTED_SYSTEM_PATH]')
  return cleaned
}

class SafeLogger {
  private log(level: LogLevel, message: string, meta?: Record<string, unknown> | unknown) {
    const timestamp = new Date().toISOString()
    const cleanMsg = sanitizeLogMessage(message)
    const prefix = `[TruthLens ${level.toUpperCase()} ${timestamp}]`

    if (level === 'error' || level === 'security') {
      console.error(`${prefix} ${cleanMsg}`, meta ? this.sanitizeMeta(meta) : '')
    } else if (level === 'warn') {
      console.warn(`${prefix} ${cleanMsg}`, meta ? this.sanitizeMeta(meta) : '')
    } else {
      console.log(`${prefix} ${cleanMsg}`, meta ? this.sanitizeMeta(meta) : '')
    }
  }

  private sanitizeMeta(meta: unknown): unknown {
    if (!meta) return ''
    if (meta instanceof Error) {
      return {
        name: meta.name,
        message: sanitizeLogMessage(meta.message),
        // Omit raw stack trace in logs if it leaks sensitive system internals
      }
    }
    if (typeof meta === 'object') {
      try {
        const json = JSON.stringify(meta)
        return JSON.parse(sanitizeLogMessage(json))
      } catch {
        return '[Unserializable Meta]'
      }
    }
    return sanitizeLogMessage(String(meta))
  }

  public info(message: string, meta?: unknown) {
    this.log('info', message, meta)
  }

  public warn(message: string, meta?: unknown) {
    this.log('warn', message, meta)
  }

  public error(message: string, meta?: unknown) {
    this.log('error', message, meta)
  }

  public security(message: string, meta?: unknown) {
    this.log('security', message, meta)
  }
}

export const logger = new SafeLogger()

/**
 * Creates a sanitized, safe JSON error response for API callers.
 * Server logs the detailed internal error while user receives safe, unrevealing message.
 */
export function createSafeErrorResponse(
  err: unknown,
  fallbackMessage = 'An internal error occurred during forensic processing.',
  statusCode = 500
): NextResponse {
  // Log full safe error to server console
  logger.error(`API Handler Exception: ${err instanceof Error ? err.message : String(err)}`, err)

  // Construct client message (avoid leaking file system paths or stack frames)
  let userMessage = fallbackMessage
  if (err instanceof Error) {
    // If it's a known validation error or client-safe error
    if (
      err.message.includes('Validation') ||
      err.message.includes('supported') ||
      err.message.includes('Security Violation') ||
      err.message.includes('not found') ||
      err.message.includes('Rate limit') ||
      err.message.includes('File exceeds')
    ) {
      userMessage = err.message
    }
  }

  return NextResponse.json(
    {
      detail: userMessage,
      status: statusCode,
      timestamp: new Date().toISOString(),
    },
    { status: statusCode }
  )
}
