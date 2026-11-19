import { NextResponse, type NextRequest } from 'next/server'
import { GUEST_COOKIE_NAME, AUTH_COOKIE_NAME, GUEST_COOKIE_MAX_AGE } from '@/lib/backend-engine/auth-constants'

export function middleware(request: NextRequest) {
  // If request already has an authenticated user session or an active guest session ID, proceed
  const hasAuth = request.cookies.has(AUTH_COOKIE_NAME)
  const hasGuest = request.cookies.has(GUEST_COOKIE_NAME)

  if (hasAuth || hasGuest) {
    return NextResponse.next()
  }

  // Generate a cryptographically secure random guest ID (32 hex characters)
  const guestSessionId = crypto.randomUUID().replace(/-/g, '')

  // Forward cookie in the request headers so downstream route handlers
  // and server components see the cookie immediately on this very first request
  const requestHeaders = new Headers(request.headers)
  const existingCookieHeader = request.headers.get('cookie') || ''
  const updatedCookieHeader = existingCookieHeader
    ? `${existingCookieHeader}; ${GUEST_COOKIE_NAME}=${guestSessionId}`
    : `${GUEST_COOKIE_NAME}=${guestSessionId}`
  requestHeaders.set('cookie', updatedCookieHeader)

  const response = NextResponse.next({
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
