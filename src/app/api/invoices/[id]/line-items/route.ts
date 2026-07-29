import { withAuth } from '@/lib/auth/with-auth'
import { invoicesService } from '@/server/services/invoices.service'
import { lineItemCreateSchema } from '@/lib/validation/schemas'
import { ok, created } from '@/lib/api-response'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  return ok(await invoicesService.listLineItems(db, id))
}, { permission: 'shipments:read' })

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = lineItemCreateSchema.parse({ ...(await req.json()), invoiceId: id })
  return created(await invoicesService.createLineItem(db, audit, input))
}, { permission: 'shipments:write' })
