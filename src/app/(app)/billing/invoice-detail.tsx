'use client'

/** Render the saved invoice identically on screen and in the browser's PDF/print output. */
import { createPortal } from 'react-dom'
import type { BillingInvoiceRow } from '@/lib/billing-types'
import { d, moneyString } from '@/lib/calculations/money'
import { money, isoDate } from '@/lib/format'

export function InvoiceDocument({ invoice }: { invoice: BillingInvoiceRow }) {
  return <article className="billing-document">
    <header><div><h2>{invoice.organization.name}</h2><p>{invoice.organization.address}</p><p>{[invoice.organization.email, invoice.organization.phone].filter(Boolean).join(' · ')}</p>{invoice.organization.tinNumber && <p>TIN: {invoice.organization.tinNumber}</p>}</div><div><h1>INVOICE</h1><strong>{invoice.invoiceNumber}</strong><p>{invoice.status.replaceAll('_', ' ')}</p><p>Issued: {isoDate(invoice.issueDate)}</p><p>Due: {isoDate(invoice.dueDate)}</p></div></header>
    <section><h3>Bill to</h3><strong>{invoice.client.name}</strong><p>{invoice.client.address}</p><p>{invoice.client.email}</p>{invoice.client.tinNumber && <p>TIN: {invoice.client.tinNumber}</p>}</section>
    <p className="currency">All amounts in BSD</p>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th><th>VAT</th></tr></thead><tbody>{invoice.items.map((item) => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(item.amount)}</td><td>{money(item.vatAmount)}</td></tr>)}</tbody></table>
    <dl>{[['Subtotal', invoice.subtotal], ['VAT', invoice.vatAmount], ['Total', invoice.total], ['Paid', invoice.amountPaid], ['Balance due', moneyString(d(invoice.total).minus(invoice.amountPaid))]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value)}</dd></div>)}</dl>
    {invoice.notes && <section><h3>Notes</h3><p>{invoice.notes}</p></section>}
    {invoice.payments.length > 0 && <section><h3>Payments</h3><table><thead><tr><th>Date</th><th>Method / reference</th><th>Amount</th></tr></thead><tbody>{invoice.payments.map((payment) => <tr key={payment.id}><td>{isoDate(payment.receivedAt)}</td><td>{payment.method.replaceAll('_', ' ')} {payment.reference}</td><td>{money(payment.amount)}</td></tr>)}</tbody></table></section>}
  </article>
}

export function InvoiceDetail({ invoice, onEdit, onClose }: { invoice: BillingInvoiceRow; onEdit: () => void; onClose: () => void }) {
  const editable = ['DRAFT', 'SENT'].includes(invoice.status) && d(invoice.amountPaid).isZero() && invoice.payments.length === 0
  return <>
    <style>{`
      .billing-print-root { display: none; }
      .billing-document { background: white; color: #172b3a; padding: 32px; font: 14px/1.5 Arial, sans-serif; overflow-wrap: anywhere; }
      .billing-document header { display: flex; justify-content: space-between; gap: 32px; border-bottom: 2px solid #172b3a; padding-bottom: 20px; margin-bottom: 24px; }
      .billing-document h1 { font-size: 26px; margin: 0 0 8px; }
      .billing-document h2 { font-size: 20px; margin: 0 0 8px; }
      .billing-document h3 { font-size: 14px; margin: 16px 0 6px; }
      .billing-document p { margin: 3px 0; white-space: pre-wrap; }
      .billing-document .currency { text-align: right; margin: 20px 0 8px; font-size: 12px; }
      .billing-document table { width: 100%; border-collapse: collapse; }
      .billing-document th, .billing-document td { padding: 10px 6px; border-bottom: 1px solid #cbd5dc; text-align: right; vertical-align: top; }
      .billing-document th:first-child, .billing-document td:first-child { text-align: left; }
      .billing-document thead { display: table-header-group; }
      .billing-document tr { break-inside: avoid; }
      .billing-document dl { width: 260px; max-width: 100%; margin: 20px 0 20px auto; break-inside: avoid; }
      .billing-document dl div { display: flex; justify-content: space-between; padding: 5px 0; gap: 16px; }
      .billing-document dd { margin: 0; }
      .billing-document dl div:last-child { font-weight: bold; border-top: 2px solid #172b3a; }
      @media print {
        @page { margin: 15mm; }
        body > * { display: none !important; }
        body > .billing-print-root { display: block !important; }
        .billing-document { padding: 0; font-size: 11pt; }
      }
    `}</style>
    <div className="sb-card" style={{ marginBottom: 16 }}>
      <div className="sb-pad" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="sb-btn" onClick={onClose}>Close invoice</button>
        {editable && <button className="sb-btn is-primary" onClick={onEdit}>Edit invoice</button>}
        <button className="sb-btn" onClick={() => window.print()}>Print / Save PDF</button>
        {!editable && <p className="sb-meta">Invoices with payments or a void status cannot be edited.</p>}
      </div>
      <InvoiceDocument invoice={invoice} />
    </div>
    {createPortal(<div className="billing-print-root"><InvoiceDocument invoice={invoice} /></div>, document.body)}
  </>
}
