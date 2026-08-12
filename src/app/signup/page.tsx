'use client'

/**
 * Sign up. Posts to /api/auth/register (email/password), or hands off to
 * /api/auth/google for "Continue with Google" — both create an Organization
 * + OWNER user the same way (see authService.register /
 * loginOrRegisterWithGoogle), so the organization name field is shared by
 * both paths.
 */
import { Suspense, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  org_name_required: 'Enter your organization name before continuing with Google.',
  google_denied: 'Google sign-in was cancelled.',
  google_state_invalid: 'That sign-in attempt expired or could not be verified. Please try again.',
  google_email_unverified: "Your Google account's email isn't verified. Verify it with Google first.",
  google_auth_failed: 'Google sign-in failed. Please try again.',
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  )
}

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const googleError = searchParams.get('error')

  const [organizationName, setOrganizationName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    googleError ? (GOOGLE_ERROR_MESSAGES[googleError] ?? GOOGLE_ERROR_MESSAGES.google_auth_failed) : null,
  )
  const [busy, setBusy] = useState(false)
  const orgNameRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationName, firstName, lastName, email, password }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body?.error?.message ?? 'Sign-up failed')
        return
      }
      router.push('/home')
    } finally {
      setBusy(false)
    }
  }

  function onGoogleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!organizationName.trim()) {
      e.preventDefault()
      setError('Enter your organization name before continuing with Google.')
      orgNameRef.current?.focus()
    }
  }

  const googleHref = `/api/auth/google?intent=signup&orgName=${encodeURIComponent(organizationName.trim())}`

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <div className="text-3xl font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
            Submit
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
            Create your brokerage&apos;s account.
          </p>
        </header>

        <div className="rounded-lg border bg-white p-6" style={{ borderColor: 'var(--line)' }}>
          {error && (
            <p className="mb-4 text-sm" style={{ color: 'var(--danger)' }} role="alert" aria-live="polite">
              {error}
            </p>
          )}

          <form onSubmit={submit} className="space-y-4" noValidate>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                Organization name
              </span>
              <input
                ref={orgNameRef}
                type="text"
                required
                autoComplete="organization"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
                style={{ borderColor: 'var(--line)' }}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                  First name
                </span>
                <input
                  type="text"
                  required
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
                  style={{ borderColor: 'var(--line)' }}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                  Last name
                </span>
                <input
                  type="text"
                  required
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
                  style={{ borderColor: 'var(--line)' }}
                />
              </label>
            </div>

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
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
                style={{ borderColor: 'var(--line)' }}
              />
              <span className="mt-1 block text-xs" style={{ color: 'var(--ink-soft)' }}>
                At least 10 characters.
              </span>
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--accent)' }}
            >
              {busy ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3" role="presentation">
            <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
            <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              or
            </span>
            <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
          </div>

          <a
            href={googleHref}
            onClick={onGoogleClick}
            className="flex w-full items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-semibold outline-none focus:ring-2"
            style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.94v2.33A9 9 0 0 0 9 18Z"
              />
              <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.94A9 9 0 0 0 0 9c0 1.45.35 2.83.94 4.03l3.01-2.33Z" />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.97l3.01 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
              />
            </svg>
            Continue with Google
          </a>
        </div>

        <p className="mt-4 text-sm" style={{ color: 'var(--ink-soft)' }}>
          Already have an account?{' '}
          <a href="/login" className="font-semibold underline" style={{ color: 'var(--accent)' }}>
            Sign in
          </a>
        </p>
      </div>
    </main>
  )
}
