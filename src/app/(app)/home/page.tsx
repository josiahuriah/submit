import Link from 'next/link'
import { getHomeDashboard } from '@/lib/data/home'
import { Chip, KpiCard } from '@/components/ui/primitives'
import { money } from '@/lib/format'

const statusKind = {
  DRAFT: 'draft',
  SUBMITTED: 'acc',
  CLEARED: 'pos',
  CANCELLED: 'neg',
} as const

export default async function HomePage() {
  const dashboard = await getHomeDashboard()
  const setupIncomplete = dashboard.counts.activeClients === 0 || dashboard.counts.activeSuppliers === 0

  return (
    <div className="sb-page">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 16 }}>
        <div>
          <h1 className="sb-h1">Operations</h1>
          <p className="sb-meta" style={{ marginTop: 4 }}>Declaration workload, Customs-review readiness, and receivables.</p>
        </div>
        <div style={{ flex: 1 }} />
        <Link href="/shipments/new" className="sb-btn is-primary">New shipment</Link>
      </div>

      {setupIncomplete && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: '3px solid var(--sb-gold)' }}>
          <div className="sb-strong">Finish directory setup</div>
          <div className="sb-meta" style={{ marginTop: 3, marginBottom: 9 }}>A declaration needs a client and supplier before invoices and tariff lines can be entered.</div>
          <Link className="sb-btn is-sm" href="/clients">Add master data</Link>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Draft declarations" value={dashboard.counts.draftShipments} sub="Require preparation or review" tone="gold" />
        <KpiCard label="Review XML artifacts" value={dashboard.counts.reviewArtifacts} sub="Stored, versioned artifacts" tone="acc" />
        <KpiCard label="Open manifests" value={dashboard.counts.openManifests} sub="Available for shipments" />
        <KpiCard label="Outstanding A/R" value={money(dashboard.receivables.outstanding)} sub={`${dashboard.counts.overdueInvoices} overdue invoices`} tone={dashboard.counts.overdueInvoices ? 'neg' : 'pos'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, .85fr)', gap: 16 }}>
        <section className="sb-card" style={{ overflow: 'hidden' }}>
          <div className="sb-pad" style={{ display: 'flex', alignItems: 'baseline' }}><div className="sb-h2">Recent shipments</div><div style={{ flex: 1 }} /><Link href="/shipments" className="sb-rowlink">View all</Link></div>
          <table className="sb-tbl"><thead><tr><th>Shipment</th><th>Client</th><th>Status</th><th>Calculation</th><th className="sb-num">Payable</th></tr></thead><tbody>
            {dashboard.recentShipments.map((shipment) => <tr key={shipment.id}>
              <td><Link href={`/shipments/${shipment.id}/entry`} className="sb-rowlink sb-mono">{shipment.shipmentNumber}</Link><div className="sb-meta sb-mono">{shipment.blNumber}</div></td>
              <td>{shipment.clientName}</td>
              <td><Chip kind={statusKind[shipment.status]}>{shipment.status}</Chip></td>
              <td><Chip kind={shipment.calculated ? 'pos' : 'gold'}>{shipment.calculated ? 'Current' : 'Required'}</Chip></td>
              <td className="sb-num sb-mono">{shipment.calculated ? money(shipment.totalPayable) : '—'}</td>
            </tr>)}
            {dashboard.recentShipments.length === 0 && <tr><td colSpan={5} className="sb-meta" style={{ padding: 26, textAlign: 'center' }}>No shipments yet. Add directory records, then create the first declaration.</td></tr>}
          </tbody></table>
        </section>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="sb-card sb-pad"><div className="sb-h2" style={{ marginBottom: 10 }}>Directory readiness</div><div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}><span>Active clients</span><b className="sb-mono">{dashboard.counts.activeClients}</b><span>Active suppliers</span><b className="sb-mono">{dashboard.counts.activeSuppliers}</b><span>Open manifests</span><b className="sb-mono">{dashboard.counts.openManifests}</b></div></div>
          <div className="sb-card sb-pad"><div className="sb-h2" style={{ marginBottom: 10 }}>Receivables</div><div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}><span>Total billed</span><b className="sb-mono">{money(dashboard.receivables.billed)}</b><span>Payments received</span><b className="sb-mono" style={{ color: 'var(--sb-pos)' }}>{money(dashboard.receivables.paid)}</b><span>Outstanding</span><b className="sb-mono">{money(dashboard.receivables.outstanding)}</b></div><Link href="/accounting" className="sb-btn is-sm" style={{ marginTop: 12 }}>Open accounting</Link></div>
        </aside>
      </div>
    </div>
  )
}
