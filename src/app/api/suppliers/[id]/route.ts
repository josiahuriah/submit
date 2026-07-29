import { withAuth } from '@/lib/auth/with-auth'
import { catalogService } from '@/server/services/catalog.service'
import { supplierUpdateSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const PATCH = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = supplierUpdateSchema.parse(await req.json())
  return ok(await catalogService.updateSupplier(db, audit, id, input))
}, { permission: 'clients:write' })
