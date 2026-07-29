import { clearSessionCookie } from '@/lib/auth/session-cookie'
import { ok } from '@/lib/api-response'

export async function POST() {
  await clearSessionCookie()
  return ok({ loggedOut: true })
}
