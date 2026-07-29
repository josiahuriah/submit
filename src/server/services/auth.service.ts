/**
 * Auth service — the ONLY module that uses systemQuery (RLS bypass), because
 * login and registration necessarily run before an org context exists.
 *
 * Registration creates the Organization and its OWNER user atomically:
 * either both exist afterwards or neither does.
 */
import { systemQuery } from '@/lib/db/prisma'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { signSession, type SessionClaims } from '@/lib/auth/jwt'
import { ConflictError, UnauthorizedError } from '@/lib/errors'
import type { LoginInput, RegisterInput } from '@/lib/validation/schemas'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export interface AuthResult {
  token: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    organization: { id: string; name: string; slug: string }
  }
}

export const authService = {
  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password)

    const { user, organization } = await systemQuery(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: input.email } })
      if (existing) throw new ConflictError('An account with this email already exists')

      // Slug collision: append a short suffix rather than failing signup.
      const base = slugify(input.organizationName)
      const taken = await tx.organization.findUnique({ where: { slug: base } })
      const slug = taken ? `${base}-${Date.now().toString(36).slice(-4)}` : base

      const organization = await tx.organization.create({
        data: { name: input.organizationName, slug },
      })
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          role: 'OWNER',
        },
      })
      return { user, organization }
    })

    return toAuthResult(user, organization)
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const found = await systemQuery(async (tx) => {
      return tx.user.findUnique({
        where: { email: input.email },
        include: { organization: { select: { id: true, name: true, slug: true, isActive: true } } },
      })
    })

    // Same error for "no user" and "bad password" — no account enumeration.
    if (!found || !found.isActive || !found.organization.isActive) {
      throw new UnauthorizedError('Invalid email or password')
    }
    const valid = await verifyPassword(input.password, found.passwordHash)
    if (!valid) throw new UnauthorizedError('Invalid email or password')

    await systemQuery(async (tx) => {
      await tx.user.update({ where: { id: found.id }, data: { lastLoginAt: new Date() } })
    })

    return toAuthResult(found, found.organization)
  },

  async me(claims: SessionClaims) {
    const user = await systemQuery(async (tx) =>
      tx.user.findUnique({
        where: { id: claims.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
    )
    if (!user || !user.isActive) throw new UnauthorizedError('Account is no longer active')
    return user
  },
}

function toAuthResult(
  user: { id: string; email: string; firstName: string; lastName: string; role: string; organizationId: string },
  organization: { id: string; name: string; slug: string },
): AuthResult {
  const token = signSession({
    sub: user.id,
    orgId: organization.id,
    role: user.role as SessionClaims['role'],
    email: user.email,
  })
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organization,
    },
  }
}
