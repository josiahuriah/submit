import { withAuth } from '@/lib/auth/with-auth'
import { calculationsService } from '@/server/services/calculations.service'
import { calculateOptionsSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const options = calculateOptionsSchema.parse(body)
  return ok(await calculationsService.calculate(db, audit, id, options))
}, { permission: 'shipments:write' })
