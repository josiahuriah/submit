import { withAuth } from '@/lib/auth/with-auth'
import { shipmentsService } from '@/server/services/shipments.service'
import { shipmentCreateSchema, shipmentListQuery } from '@/lib/validation/schemas'
import { ok, created } from '@/lib/api-response'

export const GET = withAuth(async (req, { db }) => {
  const query = shipmentListQuery.parse(Object.fromEntries(req.nextUrl.searchParams))
  const page = await shipmentsService.list(db, query)
  return ok(page.items, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } })
}, { permission: 'shipments:read' })

export const POST = withAuth(async (req, { db, audit, claims }) => {
  const input = shipmentCreateSchema.parse(await req.json())
  const shipment = await shipmentsService.create(db, audit, {
    ...input,
    createdById: claims.sub,
  })
  return created(shipment)
}, { permission: 'shipments:write' })
