import { withAuth } from '@/lib/auth/with-auth'
import { hsCodesService } from '@/server/services/hs-codes.service'
import { hsCodeSearchQuery } from '@/lib/validation/schemas'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (req) => {
  const { q, limit } = hsCodeSearchQuery.parse(Object.fromEntries(req.nextUrl.searchParams))
  return ok(await hsCodesService.search(q, limit))
}, { permission: 'shipments:read' })
