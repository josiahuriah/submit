import { withAuth } from '@/lib/auth/with-auth'
import { shipmentsService } from '@/server/services/shipments.service'
import { shipmentUpdateSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  return ok(await shipmentsService.get(db, id))
}, { permission: 'shipments:read' })

export const PATCH = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = shipmentUpdateSchema.parse(await req.json())
  return ok(await shipmentsService.update(db, audit, id, input))
}, { permission: 'shipments:write' })

export const DELETE = withAuth(async (_req, { db, audit, params }) => {
  const { id } = await params
  await shipmentsService.remove(db, audit, id)
  return ok({ deleted: true })
}, { permission: 'shipments:write' })
