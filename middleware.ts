import { NextResponse, type NextRequest } from 'next/server'
import { GUEST_COOKIE_NAME, AUTH_COOKIE_NAME, GUEST_COOKIE_MAX_AGE } from '@/lib/backend-engine/auth-constants'

// Configured allowed origins from environment variable
const configuredOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : []

const ALLOWED_HEADERS = [
  'X-CSRF-Token',
  'X-Requested-With',
  'Accept',
  'Accept-Version',
  'Content-Length',
  'Content-MD5',
  'Content-Type',
  'Date',
  'X-Api-Version',
  'Authorization',
  'x-user-id',
].join(', ')

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS'

/**
 * Validates whether the incoming request origin is permitted.
 * Strictly prevents wildcard origin (*) with credentials.
 */
function isAllowedOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false

  // 1. Check against explicitly configured production origins
  if (configuredOrigins.length > 0) {
    if (configuredOrigins.includes(origin)) return true
    for (const allowed of configuredOrigins) {
      if (allowed === origin) return true
    }
  }

  // 2. Allow same origin
  try {
    const reqUrl = new URL(requestUrl)
    if (origin === reqUrl.origin) return true
  } catch {
    // ignore parse error
  }

  // 3. In development / test, allow localhost and loopback interfaces
  const isDev = process.env.NODE_ENV !== 'production'
  if (isDev) {
    try {
      const parsed = new URL(origin)
      if (
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0'
      ) {
        return true
      }
    } catch {
      return false
    }
  }

  return false
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin')
  const isApiRoute = request.nextUrl.pathname.startsWith('/api')

  // Preflight OPTIONS handling
  if (request.method === 'OPTIONS') {
    const preflightHeaders = new Headers()

    if (origin && isAllowedOrigin(origin, request.url)) {
      preflightHeaders.set('Access-Control-Allow-Origin', origin)
      preflightHeaders.set('Access-Control-Allow-Credentials', 'true')
      preflightHeaders.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
      preflightHeaders.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
      preflightHeaders.set('Access-Control-Max-Age', '86400')
      preflightHeaders.set('Vary', 'Origin')
    } else {
      // Disallow preflight for unauthorized origins
      return new NextResponse(null, { status: 403 })
    }

    return new NextResponse(null, {
      status: 204,
      headers: preflightHeaders,
    })
  }

  // Check existing session
  const hasAuth = request.cookies.has(AUTH_COOKIE_NAME) || request.cookies.has('tl_session')
  const hasGuest = request.cookies.has(GUEST_COOKIE_NAME) || request.cookies.has('tl_session_id')

  let response: NextResponse

  if (hasAuth || hasGuest) {
    response = NextResponse.next()
  } else {
    // Generate a cryptographically secure random guest ID (32 hex characters)
    const guestSessionId = crypto.randomUUID().replace(/-/g, '')

    // Forward cookie in the request headers so downstream route handlers see it immediately
    const requestHeaders = new Headers(request.headers)
    const existingCookieHeader = request.headers.get('cookie') || ''
    const updatedCookieHeader = existingCookieHeader
      ? `${existingCookieHeader}; ${GUEST_COOKIE_NAME}=${guestSessionId}; tl_session_id=${guestSessionId}`
      : `${GUEST_COOKIE_NAME}=${guestSessionId}; tl_session_id=${guestSessionId}`
    requestHeaders.set('cookie', updatedCookieHeader)

    response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })

    // Set persistent secure HTTP-only guest session cookie
    response.cookies.set(GUEST_COOKIE_NAME, guestSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE,
    })
    response.cookies.set('tl_session_id', guestSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_COOKIE_MAX_AGE,
    })
  }

  // Apply CORS headers to API routes if origin is allowed
  if (isApiRoute && origin) {
    if (isAllowedOrigin(origin, request.url)) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      response.headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
      response.headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
      response.headers.set('Vary', 'Origin')
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static media/assets (.svg, .png, .jpg, .jpeg, .mp4, .wav, .mp3, .onnx, .glb, .txt)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|wav|mp3|onnx|glb|txt)$).*)',
  ],
}
