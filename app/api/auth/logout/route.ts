import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { authService, AUTH_COOKIE_NAME } from '@/lib/backend-engine/auth-service'

export async function POST(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value
  if (token) {
    await authService.deleteSessionAsync(token)
  }

  const response = NextResponse.json(
    { message: 'Signed out successfully.' },
    { status: 200 }
  )

  response.cookies.delete(AUTH_COOKIE_NAME)

  // Issue a fresh, clean guest session ID so logged-out state is completely isolated
  const freshGuestId = crypto.randomUUID().replace(/-/g, '')
  authService.attachGuestCookie(response, freshGuestId)

  return response
}
