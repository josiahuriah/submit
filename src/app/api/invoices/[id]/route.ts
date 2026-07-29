import { withAuth } from '@/lib/auth/with-auth'
import { invoicesService } from '@/server/services/invoices.service'
import { invoiceUpdateSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const PATCH = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = invoiceUpdateSchema.parse(await req.json())
  return ok(await invoicesService.updateInvoice(db, audit, id, input))
}, { permission: 'shipments:write' })

export const DELETE = withAuth(async (_req, { db, audit, params }) => {
  const { id } = await params
  await invoicesService.deleteInvoice(db, audit, id)
  return ok({ deleted: true })
}, { permission: 'shipments:write' })
