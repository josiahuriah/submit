import { withAuth } from '@/lib/auth/with-auth'
import { ok } from '@/lib/api-response'
import { NotFoundError } from '@/lib/errors'
import { hsCodesService } from '@/server/services/hs-codes.service'

/** Read-only rate ledger with validity dates and legal-source provenance. */
export const GET = withAuth(async (_req, { params }) => {
  const { code } = await params
  const result = await hsCodesService.rateHistory(decodeURIComponent(code))
  if (!result) throw new NotFoundError('HS code')
  return ok(result)
}, { permission: 'shipments:read' })
