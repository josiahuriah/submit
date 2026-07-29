/**
 * withAuth() — request-layer tenancy (isolation layer 2).
 *
 * A higher-order function that wraps a route handler and provides an
 * AuthContext: verified claims + a tenant-scoped Prisma client built from
 * the token's orgId. Handlers never see the unscoped client.
 *
 * Usage:
 *   export const GET = withAuth(async (req, { db, claims }) => { ... })
 *   export const POST = withAuth(handler, { permission: 'shipments:write' })
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { verifySession, type SessionClaims } from './jwt'
import { SESSION_COOKIE } from './session-cookie'
import { requirePermission, type Permission } from './rbac'
import { createTenantClient, type TenantClient } from '@/lib/db/tenant-client'
import { UnauthorizedError } from '@/lib/errors'
import { fail } from '@/lib/api-response'
import type { AuditContext } from '@/lib/audit'

export interface AuthContext {
  claims: SessionClaims
  db: TenantClient
  audit: AuditContext
  /** Route params for dynamic segments (Next 15+: async). */
  params: Promise<Record<string, string>>
}

type Handler = (req: NextRequest, ctx: AuthContext) => Promise<NextResponse> | NextResponse

interface WithAuthOptions {
  permission?: Permission
}

function extractToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length)
  return req.cookies.get(SESSION_COOKIE)?.value ?? null
}

export function withAuth(handler: Handler, options: WithAuthOptions = {}) {
  // Second param typed loosely: Next 15.5 generates a RouteContext type per
  // route (params differ by dynamic segments), and a generic wrapper must be
  // assignable to all of them.
  return async (
    req: NextRequest,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routeCtx: any,
  ): Promise<NextResponse> => {
    try {
      const token = extractToken(req)
      if (!token) throw new UnauthorizedError()

      const claims = verifySession(token)
      if (options.permission) requirePermission(claims.role, options.permission)

      const db = createTenantClient(claims.orgId)
      const audit: AuditContext = {
        userId: claims.sub,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: req.headers.get('user-agent') ?? undefined,
      }

      return await handler(req, {
        claims,
        db,
        audit,
        params: routeCtx?.params ?? Promise.resolve({}),
      })
    } catch (error) {
      return fail(error)
    }
  }
}
