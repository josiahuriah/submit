import { withAuth } from '@/lib/auth/with-auth'
import { authService } from '@/server/services/auth.service'
import { ok } from '@/lib/api-response'

export const GET = withAuth(async (_req, { claims }) => {
  const user = await authService.me(claims)
  return ok({ user })
})
