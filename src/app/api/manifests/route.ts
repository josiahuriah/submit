import { withAuth } from '@/lib/auth/with-auth'
import { catalogService } from '@/server/services/catalog.service'
import { manifestCreateSchema, paginationQuery } from '@/lib/validation/schemas'
import { ok, created } from '@/lib/api-response'

export const GET = withAuth(async (req, { db }) => {
  const query = paginationQuery.parse(Object.fromEntries(req.nextUrl.searchParams))
  const page = await catalogService.listManifests(db, query)
  return ok(page.items, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } })
}, { permission: 'shipments:read' })

export const POST = withAuth(async (req, { db, audit }) => {
  const input = manifestCreateSchema.parse(await req.json())
  return created(await catalogService.createManifest(db, audit, input))
}, { permission: 'shipments:write' })
