import { withAuth } from '@/lib/auth/with-auth'
import { invoicesService } from '@/server/services/invoices.service'
import { invoiceCreateSchema } from '@/lib/validation/schemas'
import { created } from '@/lib/api-response'

export const POST = withAuth(async (req, { db, audit }) => {
  const input = invoiceCreateSchema.parse(await req.json())
  return created(await invoicesService.createInvoice(db, audit, {
    ...input,
    subTotal: input.subTotal,
  }))
}, { permission: 'shipments:write' })
