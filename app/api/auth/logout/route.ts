import { NextRequest, NextResponse } from 'next/server'
import { authService } from '@/lib/backend-engine/auth-service'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('tl_session')?.value
  if (token) {
    authService.deleteSession(token)
  }

  const response = NextResponse.json(
    { message: 'Signed out successfully.' },
    { status: 200 }
  )

  response.cookies.delete('tl_session')
  return response
}
