import type { NextRequest } from 'next/server'
import { loginSchema } from '@/lib/validation/schemas'
import { authService } from '@/server/services/auth.service'
import { setSessionCookie } from '@/lib/auth/session-cookie'
import { ok, fail } from '@/lib/api-response'

export async function POST(req: NextRequest) {
  try {
    const input = loginSchema.parse(await req.json())
    const result = await authService.login(input)
    await setSessionCookie(result.token)
    return ok({ user: result.user })
  } catch (error) {
    return fail(error)
  }
}
