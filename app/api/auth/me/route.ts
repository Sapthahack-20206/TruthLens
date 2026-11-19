import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/lib/backend-engine/auth-service'

export async function GET(req: NextRequest) {
  const { user, isGuest, effectiveUserId, guestSessionId } = authService.getAuthContext(req)

  const response = NextResponse.json(
    {
      user,
      isGuest,
      effectiveUserId,
    },
    { status: 200 }
  )

  // If a new guest was created, persist the cookie so their actions remain consistent
  if (guestSessionId && !req.cookies.has('tl_session_id')) {
    response.cookies.set('tl_session_id', guestSessionId, {
      httpOnly: false, // Accessible to client for session correlation
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60, // 1 year
    })
  }

  return response
}
