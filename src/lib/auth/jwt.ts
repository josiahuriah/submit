/**
 * JWT session tokens. HS256, short-lived, httpOnly cookie transport.
 * The orgId claim is what scopes every DB query — it comes only from a
 * verified token, never from request input.
 */
import jwt from 'jsonwebtoken'
import { env } from '@/lib/env'
import { UnauthorizedError } from '@/lib/errors'
import type { UserRole } from '@/generated/prisma/enums'

export interface SessionClaims {
  /** user id */
  sub: string
  orgId: string
  role: UserRole
  email: string
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, env().JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env().SESSION_TTL_SECONDS,
    issuer: 'submit',
  })
}

export function verifySession(token: string): SessionClaims {
  try {
    const decoded = jwt.verify(token, env().JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'submit',
    }) as jwt.JwtPayload
    if (!decoded.sub || !decoded.orgId || !decoded.role) {
      throw new UnauthorizedError('Malformed session token')
    }
    return {
      sub: decoded.sub,
      orgId: decoded.orgId as string,
      role: decoded.role as UserRole,
      email: decoded.email as string,
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err
    throw new UnauthorizedError('Invalid or expired session')
  }
}
