import { withAuth } from '@/lib/auth/with-auth'
import { billingService } from '@/server/services/billing.service'
import { paymentCreateSchema } from '@/lib/validation/schemas'
import { created } from '@/lib/api-response'

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = paymentCreateSchema.parse({ ...(await req.json()), brokerageInvoiceId: id })
  return created(await billingService.recordPayment(db, audit, input))
}, { permission: 'billing:write' })
