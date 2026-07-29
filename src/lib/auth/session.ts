/**
 * Page-level session helpers (Server Components / layouts).
 *
 * Route handlers use withAuth() (returns HTTP responses); pages and layouts
 * cannot return a response, so they redirect instead. Same cookie, same JWT,
 * different failure behavior per surface. Reading the cookie here makes the
 * whole route group dynamic — guaranteed no protected markup ever renders
 * for an anonymous visitor.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifySession, type SessionClaims } from './jwt'
import { SESSION_COOKIE } from './session-cookie'

/** Verified claims from the session cookie, or null when absent/invalid. */
export async function getSession(): Promise<SessionClaims | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    return verifySession(token)
  } catch {
    return null
  }
}

/** Claims or bounce to /login. Use in layouts guarding a route group. */
export async function requireSession(): Promise<SessionClaims> {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}
