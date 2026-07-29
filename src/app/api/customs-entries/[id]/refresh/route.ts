import { withAuth } from '@/lib/auth/with-auth'
import { declarationsService } from '@/server/services/declarations.service'
import { ok } from '@/lib/api-response'

export const POST = withAuth(async (_req, { db, audit, params }) => {
  const { id } = await params
  return ok(await declarationsService.refreshStatus(db, audit, id))
}, { permission: 'shipments:read' })
