'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiListAll } from '@/lib/client-api'
import type { BillingInvoiceRow } from '@/lib/billing-types'
import { d, moneyString, sum } from '@/lib/calculations/money'
import { isoDate, money } from '@/lib/format'
import { Chip, KpiCard } from '@/components/ui/primitives'

export function AccountingView() {
  const [invoices, setInvoices] = useState<BillingInvoiceRow[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    try { setInvoices(await apiListAll<BillingInvoiceRow>('/api/billing/invoices')) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load accounting data.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const report = useMemo(() => {
    const active = invoices.filter((invoice) => invoice.status !== 'VOID')
    const billed = sum(active.map((invoice) => invoice.total))
    const vat = sum(active.map((invoice) => invoice.vatAmount))
    const paid = sum(active.map((invoice) => invoice.amountPaid))
    const today = new Date().toISOString().slice(0, 10)
    const overdue = active.filter((invoice) => invoice.dueDate && invoice.dueDate.slice(0, 10) < today && d(invoice.total).greaterThan(invoice.amountPaid))
    const payments = active.flatMap((invoice) => invoice.payments.map((payment) => ({ ...payment, invoiceNumber: invoice.invoiceNumber, clientName: invoice.client.name }))).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    return { billed: moneyString(billed), vat: moneyString(vat), paid: moneyString(paid), outstanding: moneyString(billed.minus(paid)), overdue, payments }
  }, [invoices])

  return <div className="sb-page">
    <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 16 }}><div><h1 className="sb-h1">Accounting</h1><p className="sb-meta" style={{ marginTop: 4 }}>Accounts receivable and cash collections derived from brokerage invoices.</p></div><div style={{ flex: 1 }} /><button className="sb-btn" onClick={() => { setLoading(true); void load() }} disabled={loading}>Refresh</button></div>
    {notice && <div className="sb-card sb-pad" role="status" style={{ marginBottom: 12, borderLeft: '3px solid var(--sb-neg)' }}>{notice}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}><KpiCard label="Gross billed" value={money(report.billed)} tone="acc" /><KpiCard label="VAT billed" value={money(report.vat)} /><KpiCard label="Cash collected" value={money(report.paid)} tone="pos" /><KpiCard label="Accounts receivable" value={money(report.outstanding)} sub={`${report.overdue.length} overdue`} tone={report.overdue.length ? 'neg' : 'gold'} /></div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <section className="sb-card" style={{ overflow: 'hidden' }}><div className="sb-pad sb-h2">Outstanding invoices</div><table className="sb-tbl"><thead><tr><th>Invoice</th><th>Client</th><th>Due</th><th>Status</th><th className="sb-num">Balance</th></tr></thead><tbody>{invoices.filter((invoice) => invoice.status !== 'VOID' && d(invoice.total).greaterThan(invoice.amountPaid)).map((invoice) => <tr key={invoice.id}><td className="sb-mono sb-strong">{invoice.invoiceNumber}</td><td>{invoice.client.name}</td><td className="sb-mono">{isoDate(invoice.dueDate)}</td><td><Chip kind={report.overdue.some((row) => row.id === invoice.id) ? 'neg' : 'gold'}>{report.overdue.some((row) => row.id === invoice.id) ? 'OVERDUE' : invoice.status.replaceAll('_', ' ')}</Chip></td><td className="sb-num sb-mono">{money(d(invoice.total).minus(invoice.amountPaid).toFixed(2))}</td></tr>)}{!loading && d(report.outstanding).equals(0) && <tr><td colSpan={5} className="sb-meta" style={{ textAlign: 'center', padding: 24 }}>No outstanding receivables.</td></tr>}</tbody></table></section>
      <section className="sb-card" style={{ overflow: 'hidden' }}><div className="sb-pad sb-h2">Payment ledger</div><table className="sb-tbl"><thead><tr><th>Received</th><th>Invoice / client</th><th>Method</th><th className="sb-num">Amount</th></tr></thead><tbody>{report.payments.map((payment) => <tr key={payment.id}><td className="sb-mono">{isoDate(payment.receivedAt)}</td><td><span className="sb-mono sb-strong">{payment.invoiceNumber}</span><div className="sb-meta">{payment.clientName}</div></td><td>{payment.method.replaceAll('_', ' ')}<div className="sb-meta">{payment.reference ?? ''}</div></td><td className="sb-num sb-mono" style={{ color: 'var(--sb-pos)' }}>{money(payment.amount)}</td></tr>)}{!loading && report.payments.length === 0 && <tr><td colSpan={4} className="sb-meta" style={{ textAlign: 'center', padding: 24 }}>No payments recorded.</td></tr>}</tbody></table></section>
    </div>
  </div>
}
