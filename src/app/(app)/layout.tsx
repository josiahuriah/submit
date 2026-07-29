import type { ReactNode } from 'react'
import { AppShell } from '@/components/app-shell'
import { requireSession } from '@/lib/auth/session'
import { createTenantClient } from '@/lib/db/tenant-client'

/**
 * Layout for the (app) route group — every page under it gets the shell.
 * The auth guard runs on the server before any child renders, so an
 * unauthenticated user never receives protected markup.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const claims = await requireSession()

  const db = createTenantClient(claims.orgId)
  const [org, user] = await Promise.all([
    db.organization.findUnique({ where: { id: claims.orgId }, select: { name: true } }),
    db.user.findUnique({ where: { id: claims.sub }, select: { firstName: true, lastName: true } }),
  ])

  const initials = user
    ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
    : '??'

  return (
    <AppShell org={org?.name ?? 'Submit'} userInitials={initials}>
      {children}
    </AppShell>
  )
}
