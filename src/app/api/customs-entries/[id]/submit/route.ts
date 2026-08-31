/** Only authenticated brokers may initiate an explicit Customs submission attempt. */
import { withAuth } from '@/lib/auth/with-auth'
import { created } from '@/lib/api-response'
import { customsSubmissionSchema } from '@/lib/validation/schemas'
import { customsSubmissionService } from '@/server/services/customs-submission.service'

export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const input = customsSubmissionSchema.parse(await req.json().catch(() => ({})))
  return created(await customsSubmissionService.submit(db, audit, id, input))
}, { permission: 'shipments:submit' })
