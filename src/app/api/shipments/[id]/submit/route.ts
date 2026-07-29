import { withAuth } from '@/lib/auth/with-auth'
import { declarationsService } from '@/server/services/declarations.service'
import { submitDeclarationSchema } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

// Note the permission: shipments:submit requires BROKER or above.
// A CLERK can prepare everything but only a licensed broker files.
export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { declarationType } = submitDeclarationSchema.parse(body)
  return ok(await declarationsService.submit(db, audit, id, declarationType))
}, { permission: 'shipments:submit' })
