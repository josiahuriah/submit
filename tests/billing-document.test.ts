/** The same document component supplies the on-screen and PDF/print copies. */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InvoiceDocument } from '@/app/(app)/billing/invoice-detail'
import type { BillingInvoiceRow } from '@/lib/billing-types'

const invoice: BillingInvoiceRow = {
  id: 'invoice', invoiceNumber: 'BILL-1', status: 'DRAFT', issueDate: '2026-10-17', dueDate: null,
  subtotal: '100', vatAmount: '10', total: '110', amountPaid: '0', notes: 'Thank you',
  paymentInstructions: 'Bank: Example Bank\nAccount: Atlas Brokers <1234>',
  client: { id: 'client', name: 'Client', address: null, email: null, tinNumber: null },
  organization: { name: 'Atlas Brokers', address: null, email: null, phone: null, tinNumber: null },
  items: [], payments: [],
}

describe('invoice document', () => {
  it('uses the issuing tenant name and renders escaped payment directions separately from notes', () => {
    const html = renderToStaticMarkup(createElement(InvoiceDocument, { invoice }))
    expect(html).toContain('<h2>Atlas Brokers</h2>')
    expect(html).toContain('<h3>Payment instructions</h3>')
    expect(html).toContain('Bank: Example Bank\nAccount: Atlas Brokers &lt;1234&gt;')
    expect(html).toContain('<h3>Notes</h3><p>Thank you</p>')
    expect(html).not.toContain('My Brokerage')
  })
  it('uses other tenant names dynamically and omits empty payment instructions', () => {
    const other = { ...invoice, organization: { ...invoice.organization, name: 'Other Brokers' }, paymentInstructions: null }
    const html = renderToStaticMarkup(createElement(InvoiceDocument, { invoice: other }))
    expect(html).toContain('<h2>Other Brokers</h2>')
    expect(html).not.toContain('<h3>Payment instructions</h3>')
  })
})
