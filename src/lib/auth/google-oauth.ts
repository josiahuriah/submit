/**
 * Google OAuth 2.0 (Authorization Code flow, confidential client).
 *
 * We don't verify a Google-signed ID token locally — instead we exchange the
 * code for an access token and call Google's userinfo endpoint directly.
 * Google authenticates that request; there's nothing left for us to verify
 * beyond `email_verified`. This avoids pulling in a JWKS/RS256 dependency
 * for what boils down to "ask Google who this is."
 *
 * `signOAuthState`/`verifyOAuthState` sign the CSRF nonce + intent + pending
 * org name into the `state` param so the callback is self-contained — no
 * server-side session store needed for the ~10 minutes the flow is in
 * flight. Distinct issuer from session JWTs (jwt.ts) so the two token kinds
 * can never be confused.
 */
import jwt from 'jsonwebtoken'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const STATE_ISSUER = 'submit-oauth-state'
const STATE_TTL_SECONDS = 600

export const GOOGLE_OAUTH_NONCE_COOKIE = 'google_oauth_nonce'

export interface OAuthStatePayload {
  nonce: string
  intent: 'login' | 'signup'
  orgName?: string
}

export interface GoogleProfile {
  sub: string
  email: string
  email_verified: boolean
  given_name?: string
  family_name?: string
  name?: string
}

function getGoogleConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env()
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new AppError(
      'Google sign-in is not configured',
      500,
      'GOOGLE_NOT_CONFIGURED',
    )
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI }
}

export function signOAuthState(payload: OAuthStatePayload): string {
  return jwt.sign(payload, env().JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: STATE_TTL_SECONDS,
    issuer: STATE_ISSUER,
  })
}

export function verifyOAuthState(token: string): OAuthStatePayload {
  const decoded = jwt.verify(token, env().JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: STATE_ISSUER,
  }) as jwt.JwtPayload
  if (!decoded.nonce || !decoded.intent) {
    throw new Error('Malformed OAuth state')
  }
  return {
    nonce: decoded.nonce as string,
    intent: decoded.intent as 'login' | 'signup',
    orgName: decoded.orgName as string | undefined,
  }
}

export function buildAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string): Promise<{ access_token: string }> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    throw new AppError('Failed to exchange Google authorization code', 502, 'GOOGLE_TOKEN_EXCHANGE_FAILED')
  }
  return res.json()
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new AppError('Failed to fetch Google profile', 502, 'GOOGLE_PROFILE_FETCH_FAILED')
  }
  return res.json()
}
