import { withAuth } from '@/lib/auth/with-auth'
import { billingService } from '@/server/services/billing.service'
import { ok } from '@/lib/api-response'

export const POST = withAuth(async (_req, { db, audit, params }) => {
  const { id } = await params
  return ok(await billingService.send(db, audit, id))
}, { permission: 'billing:write' })
