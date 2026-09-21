/** Only authenticated brokers may initiate an explicit secondary Customs status request. */
import { withAuth } from '@/lib/auth/with-auth'
import { created } from '@/lib/api-response'
import { customsStatusService } from '@/server/services/customs-status.service'

export const POST = withAuth(async (_req, { db, audit, params }) => {
  const { id } = await params
  const response = created(await customsStatusService.check(db, audit, id))
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}, { permission: 'shipments:submit' })
