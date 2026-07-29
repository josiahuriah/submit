import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/auth/session-cookie'

export default async function Home() {
  const jar = await cookies()
  redirect(jar.has(SESSION_COOKIE) ? '/home' : '/login')
}
