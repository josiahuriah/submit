import { withAuth } from '@/lib/auth/with-auth'
import { catalogService } from '@/server/services/catalog.service'
import { clientUpdateSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  return ok(await catalogService.getClient(db, id))
}, { permission: 'clients:read' })

export const PATCH = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = clientUpdateSchema.parse(await req.json())
  return ok(await catalogService.updateClient(db, audit, id, input))
}, { permission: 'clients:write' })
