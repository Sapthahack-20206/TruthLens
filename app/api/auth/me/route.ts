import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/lib/backend-engine/auth-service'

export async function GET(req: NextRequest) {
  const authContext = authService.getAuthContext(req)

  const response = NextResponse.json(
    {
      user: authContext.user,
      isGuest: authContext.isGuest,
      effectiveUserId: authContext.effectiveUserId,
    },
    { status: 200 }
  )

  // Attach persistent secure guest cookie if unauthenticated
  if (authContext.isGuest && authContext.guestSessionId) {
    authService.attachGuestCookie(response, authContext)
  }

  return response
}
