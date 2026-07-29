import { z } from 'zod'
import { withAuth } from '@/lib/auth/with-auth'
import { shipmentsService } from '@/server/services/shipments.service'
import { shipmentStatusSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

const bodySchema = z.object({ status: shipmentStatusSchema })

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const { status } = bodySchema.parse(await req.json())
  return ok(await shipmentsService.transitionStatus(db, audit, id, status))
}, { permission: 'shipments:write' })
