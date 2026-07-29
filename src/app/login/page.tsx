'use client'

/**
 * Login. Posts to /api/auth/login; the API sets the httpOnly session cookie,
 * so no token ever touches client-side JS.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? 'Sign-in failed')
        return
      }
      router.push('/dashboard')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <div className="text-3xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
            Submit
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
            Bahamian customs declarations, calculated to the cent.
          </p>
        </header>

        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-6" style={{ borderColor: 'var(--line)' }}>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
              Password
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderColor: 'var(--line)' }}
            />
          </label>

          {error && (
            <p className="text-sm" style={{ color: 'var(--danger)' }} role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs" style={{ color: 'var(--ink-soft)' }}>
          Dev seed: <span className="mono">broker@bahamabrokerage.test</span> /{' '}
          <span className="mono">Password123!</span>
        </p>
      </div>
    </main>
  )
}
