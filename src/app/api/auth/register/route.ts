import type { NextRequest } from 'next/server'
import { registerSchema } from '@/lib/validation/schemas'
import { authService } from '@/server/services/auth.service'
import { setSessionCookie } from '@/lib/auth/session-cookie'
import { created, fail } from '@/lib/api-response'

export async function POST(req: NextRequest) {
  try {
    const input = registerSchema.parse(await req.json())
    const result = await authService.register(input)
    await setSessionCookie(result.token)
    return created({ user: result.user })
  } catch (error) {
    return fail(error)
  }
}
