import { withAuth } from '@/lib/auth/with-auth'
import { billingService } from '@/server/services/billing.service'
import { quoteConvertSchema } from '@/lib/validation/schemas'
import { created } from '@/lib/api-response'

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = quoteConvertSchema.parse(await req.json())
  return created(await billingService.convertToInvoice(db, audit, id, input))
}, { permission: 'billing:write' })
