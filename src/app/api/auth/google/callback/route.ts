import { NextResponse, type NextRequest } from 'next/server'
import {
  GOOGLE_OAUTH_NONCE_COOKIE,
  exchangeCodeForTokens,
  fetchGoogleProfile,
  verifyOAuthState,
} from '@/lib/auth/google-oauth'
import { authService } from '@/server/services/auth.service'
import { setSessionCookie } from '@/lib/auth/session-cookie'
import { BusinessRuleError } from '@/lib/errors'

function errorRedirect(req: NextRequest, target: '/login' | '/signup', code: string) {
  const res = NextResponse.redirect(new URL(`${target}?error=${code}`, req.url))
  res.cookies.delete(GOOGLE_OAUTH_NONCE_COOKIE)
  return res
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const stateToken = params.get('state')
  const code = params.get('code')

  // We don't know the intent until state is decoded, so default error target
  // to /login unless we can prove it was a signup attempt.
  let intentTarget: '/login' | '/signup' = '/login'

  if (params.get('error')) {
    // If we can still read state (denial still round-trips it), prefer its intent.
    try {
      if (stateToken) intentTarget = verifyOAuthState(stateToken).intent === 'signup' ? '/signup' : '/login'
    } catch {
      /* fall through with default target */
    }
    return errorRedirect(req, intentTarget, 'google_denied')
  }

  if (!stateToken || !code) {
    return errorRedirect(req, intentTarget, 'google_auth_failed')
  }

  let state
  try {
    state = verifyOAuthState(stateToken)
    intentTarget = state.intent === 'signup' ? '/signup' : '/login'
  } catch {
    return errorRedirect(req, intentTarget, 'google_state_invalid')
  }

  const nonceCookie = req.cookies.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value
  if (!nonceCookie || nonceCookie !== state.nonce) {
    return errorRedirect(req, intentTarget, 'google_state_invalid')
  }

  try {
    const { access_token } = await exchangeCodeForTokens(code)
    const profile = await fetchGoogleProfile(access_token)

    if (!profile.email_verified) {
      return errorRedirect(req, intentTarget, 'google_email_unverified')
    }

    const result = await authService.loginOrRegisterWithGoogle(profile, state.orgName)

    const res = NextResponse.redirect(new URL('/home', req.url))
    res.cookies.delete(GOOGLE_OAUTH_NONCE_COOKIE)
    await setSessionCookie(result.token)
    return res
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      // New person via the login-only flow: no org name to create an account with.
      return errorRedirect(req, '/login', 'google_no_account')
    }
    return errorRedirect(req, intentTarget, 'google_auth_failed')
  }
}
