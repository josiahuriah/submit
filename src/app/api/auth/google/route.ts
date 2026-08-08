import { randomBytes } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { GOOGLE_OAUTH_NONCE_COOKIE, buildAuthorizationUrl, signOAuthState } from '@/lib/auth/google-oauth'

const startQuery = z.object({
  intent: z.enum(['login', 'signup']),
  orgName: z.string().min(2).max(120).optional(),
})

export async function GET(req: NextRequest) {
  const parsed = startQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.redirect(new URL('/login?error=google_auth_failed', req.url))
  }
  const { intent, orgName } = parsed.data

  if (intent === 'signup' && !orgName) {
    return NextResponse.redirect(new URL('/signup?error=org_name_required', req.url))
  }

  const nonce = randomBytes(16).toString('hex')
  const state = signOAuthState({ nonce, intent, orgName })

  let authorizationUrl: string
  try {
    authorizationUrl = buildAuthorizationUrl(state)
  } catch {
    const target = intent === 'signup' ? '/signup' : '/login'
    return NextResponse.redirect(new URL(`${target}?error=google_auth_failed`, req.url))
  }

  const res = NextResponse.redirect(authorizationUrl)
  res.cookies.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth/google',
    maxAge: 600,
  })
  return res
}
