import { describe, expect, it } from 'vitest'
import { nextInvoiceId, upsertInvoice } from '@/lib/invoice-selection'
import type { InvoiceSummary } from '@/lib/types'

function invoice(id: string, invoiceDate = '2026-08-14'): InvoiceSummary {
  return {
    id,
    invoiceNumber: `INV-${id}`,
    invoiceDate,
    supplierName: `Supplier ${id}`,
    subTotal: '100.00',
    currency: 'BSD',
    exchangeRate: '1',
    incotermCode: 'FOB',
    incotermLocation: 'Miami',
  }
}

describe('supplier invoice selection', () => {
  it('selects the first invoice when it arrives after an empty initial render', () => {
    expect(nextInvoiceId([invoice('first')], '')).toBe('first')
  })

  it('selects a just-created invoice over an older valid choice', () => {
    const invoices = [invoice('old'), invoice('new')]
    expect(nextInvoiceId(invoices, 'old', 'new')).toBe('new')
  })

  it('preserves the broker’s current invoice when no new preference exists', () => {
    const invoices = [invoice('first'), invoice('selected')]
    expect(nextInvoiceId(invoices, 'selected')).toBe('selected')
  })

  it('adds the persisted invoice exactly once and keeps chronological order', () => {
    const created = invoice('new', '2026-08-14')
    const result = upsertInvoice([invoice('later', '2026-08-15'), created], created)
    expect(result.map((item) => item.id)).toEqual(['new', 'later'])
  })
})
