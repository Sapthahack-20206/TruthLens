import { NextRequest, NextResponse } from 'next/server'
import { authService, GUEST_COOKIE_NAME } from '@/lib/backend-engine/auth-service'
import { investigationStore } from '@/lib/backend-engine/investigation-store'
import { enforceRateLimit } from '@/lib/backend-engine/rate-limiter'
import { createSafeErrorResponse } from '@/lib/backend-engine/logger'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(req, 'auth')
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { detail: 'Email and password are required.' },
        { status: 400 }
      )
    }

    const { user, token } = await authService.loginUserAsync(email, password)

    // Seamlessly transfer any analysis records created while browsing as a guest
    const guestCookie = req.cookies.get(GUEST_COOKIE_NAME)?.value
    if (guestCookie) {
      await investigationStore.transferGuestRecordsAsync(`guest-${guestCookie}`, user.id)
    }

    const response = NextResponse.json(
      {
        user,
        message: 'Successfully signed in to TruthLens workspace.',
      },
      { status: 200 }
    )

    // Set secure HTTP-only cookie
    response.cookies.set('tl_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })

    return response
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed.'
    return createSafeErrorResponse(err, message, 401)
  }
}
