import { z } from 'zod'
import { withAuth } from '@/lib/auth/with-auth'
import { shipmentsService } from '@/server/services/shipments.service'
import { ok } from '@/lib/api-response'

// Manual status changes are deliberately cancellation-only. SUBMITTED and
// CLEARED will be owned by the future verified Customs endpoint workflow.
const bodySchema = z.object({ status: z.literal('CANCELLED') })

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  bodySchema.parse(await req.json())
  return ok(await shipmentsService.cancel(db, audit, id))
}, { permission: 'shipments:write' })
