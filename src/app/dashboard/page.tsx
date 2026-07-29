'use client'

/**
 * Dashboard — the shipments ledger.
 *
 * Numbers are the product: money columns are right-aligned tabular-num mono,
 * and Calculate / Submit are wired live so the whole DRAFT → calculated →
 * SUBMITTED workflow is demonstrable from this one screen.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface ShipmentRow {
  id: string
  shipmentNumber: string
  status: 'DRAFT' | 'SUBMITTED' | 'CLEARED' | 'CANCELLED'
  blNumber: string | null
  description: string | null
  totalCifValue: string
  totalPayable: string
  calculatedAt: string | null
  client: { name: string }
}

interface Me {
  firstName: string
  role: string
  organization: { name: string }
}

const STATUS_STYLE: Record<ShipmentRow['status'], string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SUBMITTED: 'bg-amber-100 text-amber-800',
  CLEARED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-700',
}

function bsd(v: string) {
  const n = Number(v)
  return n === 0 ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
}

export default function DashboardPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [rows, setRows] = useState<ShipmentRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [meRes, listRes] = await Promise.all([
      fetch('/api/auth/me'),
      fetch('/api/shipments?limit=50'),
    ])
    if (meRes.status === 401) {
      router.push('/login')
      return
    }
    const meBody = await meRes.json()
    const listBody = await listRes.json()
    setMe(meBody.data.user)
    setRows(listBody.data)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  async function act(id: string, path: string, label: string) {
    setBusyId(id)
    setNotice(null)
    try {
      const res = await fetch(`/api/shipments/${id}/${path}`, { method: 'POST' })
      const body = await res.json()
      setNotice(
        res.ok
          ? `${label} succeeded${body.data?.message ? ` — ${body.data.message}` : ''}`
          : `${label} failed: ${body?.error?.message ?? res.statusText}`,
      )
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const canSubmit = me && ['BROKER', 'ADMIN', 'OWNER'].includes(me.role)

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white" style={{ borderColor: 'var(--line)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-bold tracking-tight">Submit</span>
            <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              {me?.organization.name ?? '…'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {me && (
              <span style={{ color: 'var(--ink-soft)' }}>
                {me.firstName} · <span className="mono text-xs">{me.role}</span>
              </span>
            )}
            <button onClick={logout} className="underline underline-offset-2">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Shipments</h1>
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              Calculate duties before submission — totals are exact to the cent.
            </p>
          </div>
        </div>

        {notice && (
          <div
            className="mb-4 rounded border bg-white px-4 py-2 text-sm"
            style={{ borderColor: 'var(--line)' }}
            role="status"
          >
            {notice}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: 'var(--line)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide" style={{ borderColor: 'var(--line)', color: 'var(--ink-soft)' }}>
                <th className="px-4 py-3">Shipment</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">CIF value</th>
                <th className="px-4 py-3 text-right">Total payable</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                  <td className="px-4 py-3">
                    <div className="mono font-medium">{s.shipmentNumber}</div>
                    <div className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                      {s.blNumber ? <span className="mono">{s.blNumber}</span> : s.description}
                    </div>
                  </td>
                  <td className="px-4 py-3">{s.client.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status]}`}>
                      {s.status}
                    </span>
                    {s.status === 'DRAFT' && (
                      <div className="mt-1 text-xs" style={{ color: 'var(--ink-soft)' }}>
                        {s.calculatedAt ? 'calculated' : 'needs calculation'}
                      </div>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-right">{bsd(s.totalCifValue)}</td>
                  <td className="num px-4 py-3 text-right font-semibold">{bsd(s.totalPayable)}</td>
                  <td className="px-4 py-3 text-right">
                    {s.status === 'DRAFT' && (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => act(s.id, 'calculate', 'Calculation')}
                          disabled={busyId === s.id}
                          className="rounded border px-2 py-1 text-xs font-semibold disabled:opacity-50"
                          style={{ borderColor: 'var(--accent)', color: 'var(--accent-ink)' }}
                        >
                          Calculate
                        </button>
                        {canSubmit && (
                          <button
                            onClick={() => act(s.id, 'submit', 'Submission')}
                            disabled={busyId === s.id || !s.calculatedAt}
                            title={s.calculatedAt ? 'Submit to BEAIP' : 'Calculate first'}
                            className="rounded px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                            style={{ background: 'var(--accent)' }}
                          >
                            Submit
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
                    No shipments yet. Create one via the API to see it here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
