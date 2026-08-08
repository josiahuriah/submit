import { withAuth } from '@/lib/auth/with-auth'
import { created } from '@/lib/api-response'
import { declarationArtifactSchema } from '@/lib/validation/schemas'
import { declarationArtifactsService } from '@/server/services/declaration-artifacts.service'

/** Generate an auditable XML file for stakeholder/Customs review; never submits it. */
export const POST = withAuth(async (req, { db, audit, params }) => {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const input = declarationArtifactSchema.parse(body)
  return created(await declarationArtifactsService.generate(db, audit, id, input))
}, { permission: 'shipments:write' })
