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
import type { GoogleProfile } from '@/lib/auth/google-oauth'
import { BusinessRuleError, ConflictError, UnauthorizedError } from '@/lib/errors'
import type { LoginInput, RegisterInput } from '@/lib/validation/schemas'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function splitProfileName(profile: GoogleProfile): { firstName: string; lastName: string } {
  if (profile.given_name || profile.family_name) {
    return { firstName: profile.given_name ?? 'Google', lastName: profile.family_name ?? 'User' }
  }
  const [firstName, ...rest] = (profile.name ?? '').trim().split(/\s+/).filter(Boolean)
  return { firstName: firstName ?? 'Google', lastName: rest.join(' ') || 'User' }
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
    // Google-only accounts (no passwordHash) fail here too, same message.
    if (!found || !found.isActive || !found.organization.isActive || !found.passwordHash) {
      throw new UnauthorizedError('Invalid email or password')
    }
    const valid = await verifyPassword(input.password, found.passwordHash)
    if (!valid) throw new UnauthorizedError('Invalid email or password')

    await systemQuery(async (tx) => {
      await tx.user.update({ where: { id: found.id }, data: { lastLoginAt: new Date() } })
    })

    return toAuthResult(found, found.organization)
  },

  /**
   * Find-or-create for the Google flow: match by googleId, else by verified
   * email (auto-link to an existing password account), else create a new
   * Organization + OWNER user — which requires `orgName` since Google only
   * supplies personal identity, not a company name.
   */
  async loginOrRegisterWithGoogle(profile: GoogleProfile, orgName?: string): Promise<AuthResult> {
    const { user, organization } = await systemQuery(async (tx) => {
      const byGoogleId = await tx.user.findUnique({
        where: { googleId: profile.sub },
        include: { organization: { select: { id: true, name: true, slug: true, isActive: true } } },
      })
      if (byGoogleId) return { user: byGoogleId, organization: byGoogleId.organization }

      const byEmail = await tx.user.findUnique({
        where: { email: profile.email },
        include: { organization: { select: { id: true, name: true, slug: true, isActive: true } } },
      })
      if (byEmail) {
        const linked = await tx.user.update({
          where: { id: byEmail.id },
          data: { googleId: profile.sub },
          include: { organization: { select: { id: true, name: true, slug: true, isActive: true } } },
        })
        return { user: linked, organization: linked.organization }
      }

      if (!orgName) {
        throw new BusinessRuleError('Organization name is required to create an account')
      }

      const base = slugify(orgName)
      const taken = await tx.organization.findUnique({ where: { slug: base } })
      const slug = taken ? `${base}-${Date.now().toString(36).slice(-4)}` : base

      const organization = await tx.organization.create({ data: { name: orgName, slug } })
      const { firstName, lastName } = splitProfileName(profile)
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: profile.email,
          passwordHash: null,
          googleId: profile.sub,
          firstName,
          lastName,
          role: 'OWNER',
        },
      })
      return { user, organization }
    })

    if (!user.isActive || !organization.isActive) {
      throw new UnauthorizedError('Account is no longer active')
    }

    await systemQuery(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    })

    return toAuthResult(user, organization)
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
