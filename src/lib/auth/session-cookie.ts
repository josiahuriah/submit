/**
 * Session cookie helpers (httpOnly + Secure + SameSite=Lax).
 * httpOnly means XSS cannot read the token; Lax blocks CSRF on cross-site
 * POSTs while keeping normal navigation working.
 */
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

export const SESSION_COOKIE = 'submit_session'

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: env().SESSION_TTL_SECONDS,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
