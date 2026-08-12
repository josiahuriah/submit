'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiListAll, apiRequest, ApiClientError } from '@/lib/client-api'
import type { BillingInvoiceRow, ClientOptionRow, ShipmentOptionRow } from '@/lib/billing-types'
import { d, moneyString, sum } from '@/lib/calculations/money'
import { money, isoDate } from '@/lib/format'
import { Chip, KpiCard } from '@/components/ui/primitives'
import { Icons } from '@/components/ui/icons'

const STATUS_KIND = { DRAFT: 'draft', SENT: 'acc', PARTIALLY_PAID: 'gold', PAID: 'pos', VOID: 'neg' } as const
const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'CARD', 'OTHER'] as const

interface DraftItem { description: string; shipmentId: string; quantity: string; unitPrice: string }
const emptyItem = (): DraftItem => ({ description: 'Customs brokerage service', shipmentId: '', quantity: '1', unitPrice: '' })

function message(error: unknown) {
  if (error instanceof ApiClientError && error.details) return Object.values(error.details).flat()[0] ?? error.message
  return error instanceof Error ? error.message : 'The billing request failed.'
}

export function BillingView() {
  const [invoices, setInvoices] = useState<BillingInvoiceRow[]>([])
  const [clients, setClients] = useState<ClientOptionRow[]>([])
  const [shipments, setShipments] = useState<ShipmentOptionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null)
  const [draft, setDraft] = useState({ clientId: '', invoiceNumber: '', dueDate: '', vatRate: '0.10', notes: '', items: [emptyItem()] })
  const [payment, setPayment] = useState({ amount: '', method: 'BANK_TRANSFER', reference: '', receivedAt: new Date().toISOString().slice(0, 10) })

  const load = useCallback(async () => {
    try {
      const [invoiceRows, clientRows, shipmentRows] = await Promise.all([
        apiListAll<BillingInvoiceRow>('/api/billing/invoices'),
        apiListAll<ClientOptionRow>('/api/clients'),
        apiListAll<ShipmentOptionRow>('/api/shipments'),
      ])
      setInvoices(invoiceRows)
      setClients(clientRows.filter((client) => client.isActive))
      setShipments(shipmentRows)
      setDraft((current) => ({ ...current, clientId: current.clientId || clientRows.find((client) => client.isActive)?.id || '' }))
    } catch (error) {
      setNotice(message(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const metrics = useMemo(() => {
    const active = invoices.filter((invoice) => invoice.status !== 'VOID')
    const billed = sum(active.map((invoice) => invoice.total))
    const paid = sum(active.map((invoice) => invoice.amountPaid))
    return {
      billed: moneyString(billed),
      paid: moneyString(paid),
      outstanding: moneyString(billed.minus(paid)),
      drafts: active.filter((invoice) => invoice.status === 'DRAFT').length,
    }
  }, [invoices])

  function setItem(index: number, key: keyof DraftItem, value: string) {
    setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }))
  }

  async function createInvoice() {
    if (!draft.clientId || !draft.invoiceNumber.trim() || busy) return
    setBusy('create')
    setNotice(null)
    try {
      await apiRequest<BillingInvoiceRow>('/api/billing/invoices', {
        method: 'POST',
        body: JSON.stringify({
          clientId: draft.clientId,
          invoiceNumber: draft.invoiceNumber.trim(),
          dueDate: draft.dueDate || undefined,
          vatRate: draft.vatRate,
          notes: draft.notes.trim() || undefined,
          items: draft.items.map((item) => ({
            description: item.description.trim(),
            shipmentId: item.shipmentId || undefined,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        }),
      })
      setShowCreate(false)
      setDraft((current) => ({ ...current, invoiceNumber: '', dueDate: '', notes: '', items: [emptyItem()] }))
      await load()
    } catch (error) {
      setNotice(message(error))
    } finally {
      setBusy(null)
    }
  }

  async function sendInvoice(id: string) {
    setBusy(id)
    setNotice(null)
    try {
      await apiRequest(`/api/billing/invoices/${id}/send`, { method: 'POST' })
      await load()
    } catch (error) {
      setNotice(message(error))
    } finally { setBusy(null) }
  }

  async function recordPayment() {
    if (!paymentInvoiceId || !payment.amount || busy) return
    setBusy(paymentInvoiceId)
    setNotice(null)
    try {
      await apiRequest(`/api/billing/invoices/${paymentInvoiceId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: payment.amount, method: payment.method, reference: payment.reference.trim() || undefined, receivedAt: payment.receivedAt }),
      })
      setPaymentInvoiceId(null)
      setPayment((current) => ({ ...current, amount: '', reference: '' }))
      await load()
    } catch (error) {
      setNotice(message(error))
    } finally { setBusy(null) }
  }

  const field = { display: 'flex', flexDirection: 'column' as const, gap: 4 }
  const selectedPaymentInvoice = invoices.find((invoice) => invoice.id === paymentInvoiceId)

  return (
    <div className="sb-page">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 16 }}><div><h1 className="sb-h1">Billing</h1><p className="sb-meta" style={{ marginTop: 4 }}>Brokerage charges, invoice delivery, and client payments.</p></div><div style={{ flex: 1 }} /><button className="sb-btn is-primary" onClick={() => setShowCreate((open) => !open)}><Icons.plus /> New invoice</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}><KpiCard label="Total billed" value={money(metrics.billed)} tone="acc" /><KpiCard label="Payments received" value={money(metrics.paid)} tone="pos" /><KpiCard label="Outstanding" value={money(metrics.outstanding)} tone={d(metrics.outstanding).greaterThan(0) ? 'gold' : 'pos'} /><KpiCard label="Draft invoices" value={metrics.drafts} sub="Not yet sent" /></div>
      {notice && <div className="sb-card sb-pad" role="status" style={{ marginBottom: 12, borderLeft: '3px solid var(--sb-neg)' }}>{notice}</div>}

      {showCreate && <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: '3px solid var(--sb-accent)' }}>
        <div className="sb-h2" style={{ marginBottom: 12 }}>Create brokerage invoice</div>
        {clients.length === 0 ? <div className="sb-meta">Create an active client before raising an invoice.</div> : <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12 }}>
            <label style={field}><span className="sb-eyebrow">Client</span><select className="sb-inp" value={draft.clientId} onChange={(e) => setDraft((current) => ({ ...current, clientId: e.target.value }))}>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Invoice number</span><input className="sb-inp sb-mono" value={draft.invoiceNumber} onChange={(e) => setDraft((current) => ({ ...current, invoiceNumber: e.target.value }))} placeholder="BILL-2026-0001" /></label>
            <label style={field}><span className="sb-eyebrow">Due date</span><input className="sb-inp sb-mono" type="date" value={draft.dueDate} onChange={(e) => setDraft((current) => ({ ...current, dueDate: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">VAT rate</span><select className="sb-inp" value={draft.vatRate} onChange={(e) => setDraft((current) => ({ ...current, vatRate: e.target.value }))}><option value="0.10">10%</option><option value="0">0%</option></select></label>
          </div>
          <div className="sb-eyebrow" style={{ marginTop: 16, marginBottom: 7 }}>Invoice items</div>
          {draft.items.map((item, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr .5fr .7fr auto', gap: 10, marginBottom: 8, alignItems: 'end' }}>
            <label style={field}><span className="sb-meta">Description</span><input className="sb-inp" value={item.description} onChange={(e) => setItem(index, 'description', e.target.value)} /></label>
            <label style={field}><span className="sb-meta">Shipment</span><select className="sb-inp" value={item.shipmentId} onChange={(e) => setItem(index, 'shipmentId', e.target.value)}><option value="">— general service —</option>{shipments.filter((shipment) => shipment.client.id === draft.clientId).map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.shipmentNumber}</option>)}</select></label>
            <label style={field}><span className="sb-meta">Quantity</span><input className="sb-inp sb-mono" value={item.quantity} onChange={(e) => setItem(index, 'quantity', e.target.value)} /></label>
            <label style={field}><span className="sb-meta">Unit price</span><input className="sb-inp sb-mono" value={item.unitPrice} onChange={(e) => setItem(index, 'unitPrice', e.target.value)} placeholder="0.00" /></label>
            <button className="sb-btn is-sm" disabled={draft.items.length === 1} onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>
          </div>)}
          <button className="sb-btn is-sm" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, emptyItem()] }))}><Icons.plus /> Add item</button>
          <label style={{ ...field, marginTop: 12 }}><span className="sb-eyebrow">Notes</span><textarea className="sb-inp" rows={2} value={draft.notes} onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))} /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}><button className="sb-btn" onClick={() => setShowCreate(false)} disabled={busy === 'create'}>Cancel</button><button className="sb-btn is-primary" onClick={() => void createInvoice()} disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create draft invoice'}</button></div>
        </>}
      </div>}

      {selectedPaymentInvoice && <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: '3px solid var(--sb-pos)' }}><div className="sb-h2">Record payment · {selectedPaymentInvoice.invoiceNumber}</div><div className="sb-meta" style={{ margin: '3px 0 12px' }}>Outstanding {money(d(selectedPaymentInvoice.total).minus(selectedPaymentInvoice.amountPaid).toFixed(2))}</div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.5fr auto', gap: 10, alignItems: 'end' }}><label style={field}><span className="sb-eyebrow">Amount</span><input className="sb-inp sb-mono" value={payment.amount} onChange={(e) => setPayment((current) => ({ ...current, amount: e.target.value }))} /></label><label style={field}><span className="sb-eyebrow">Method</span><select className="sb-inp" value={payment.method} onChange={(e) => setPayment((current) => ({ ...current, method: e.target.value }))}>{PAYMENT_METHODS.map((method) => <option key={method}>{method.replaceAll('_', ' ')}</option>)}</select></label><label style={field}><span className="sb-eyebrow">Received</span><input className="sb-inp" type="date" value={payment.receivedAt} onChange={(e) => setPayment((current) => ({ ...current, receivedAt: e.target.value }))} /></label><label style={field}><span className="sb-eyebrow">Reference</span><input className="sb-inp" value={payment.reference} onChange={(e) => setPayment((current) => ({ ...current, reference: e.target.value }))} /></label><div style={{ display: 'flex', gap: 6 }}><button className="sb-btn" onClick={() => setPaymentInvoiceId(null)}>Cancel</button><button className="sb-btn is-primary" onClick={() => void recordPayment()} disabled={busy === selectedPaymentInvoice.id}>Save</button></div></div></div>}

      <div className="sb-card" style={{ overflowX: 'auto' }}><table className="sb-tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Issued / due</th><th>Status</th><th className="sb-num">Subtotal</th><th className="sb-num">VAT</th><th className="sb-num">Total</th><th className="sb-num">Balance</th><th /></tr></thead><tbody>
        {invoices.map((invoice) => { const balance = d(invoice.total).minus(invoice.amountPaid); return <tr key={invoice.id}><td><span className="sb-mono sb-strong">{invoice.invoiceNumber}</span><div className="sb-meta">{invoice.items.length} item{invoice.items.length === 1 ? '' : 's'}</div></td><td>{invoice.client.name}</td><td className="sb-mono"><div>{isoDate(invoice.issueDate)}</div><div className="sb-meta">due {isoDate(invoice.dueDate)}</div></td><td><Chip kind={STATUS_KIND[invoice.status]}>{invoice.status.replaceAll('_', ' ')}</Chip></td><td className="sb-num sb-mono">{money(invoice.subtotal)}</td><td className="sb-num sb-mono">{money(invoice.vatAmount)}</td><td className="sb-num sb-mono sb-strong">{money(invoice.total)}</td><td className="sb-num sb-mono" style={{ color: balance.greaterThan(0) ? 'var(--sb-neg)' : 'var(--sb-pos)' }}>{money(balance.toFixed(2))}</td><td><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>{invoice.status === 'DRAFT' && <button className="sb-btn is-sm" disabled={busy === invoice.id} onClick={() => void sendInvoice(invoice.id)}>Send</button>}{['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && <button className="sb-btn is-sm" onClick={() => { setPaymentInvoiceId(invoice.id); setPayment((current) => ({ ...current, amount: balance.toFixed(2) })) }}>Payment</button>}</div></td></tr> })}
        {!loading && invoices.length === 0 && <tr><td colSpan={9} className="sb-meta" style={{ textAlign: 'center', padding: 28 }}>No brokerage invoices yet.</td></tr>}
      </tbody></table>{loading && <div className="sb-pad sb-meta">Loading invoices…</div>}</div>
    </div>
  )
}
