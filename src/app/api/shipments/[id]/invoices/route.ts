import { withAuth } from '@/lib/auth/with-auth'
import { invoicesService } from '@/server/services/invoices.service'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (_req, { db, params }) => {
  const { id } = await params
  return ok(await invoicesService.listForShipment(db, id))
}, { permission: 'shipments:read' })
