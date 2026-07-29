import { withAuth } from '@/lib/auth/with-auth'
import { catalogService } from '@/server/services/catalog.service'
import { manifestUpdateSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  return ok(await catalogService.getManifest(db, id))
}, { permission: 'shipments:read' })

export const PATCH = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = manifestUpdateSchema.parse(await req.json())
  return ok(await catalogService.updateManifest(db, audit, id, input))
}, { permission: 'shipments:write' })
