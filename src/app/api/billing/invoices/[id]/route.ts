import { brokerageInvoiceUpdateSchema } from '@/lib/validation/schemas'
import { withAuth } from '@/lib/auth/with-auth'
import { billingService } from '@/server/services/billing.service'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  return ok(await billingService.get(db, id))
}, { permission: 'billing:read' })

export const PATCH = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = brokerageInvoiceUpdateSchema.parse(await req.json())
  return ok(await billingService.update(db, audit, id, input))
}, { permission: 'billing:write' })
