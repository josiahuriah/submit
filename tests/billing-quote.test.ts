import { describe, it, expect } from 'vitest'
import { brokerageInvoiceCreateSchema, quoteConvertSchema } from '@/lib/validation/schemas'

describe('brokerage quote validation', () => {
  const baseItems = [{ description: 'Customs clearance', quantity: '1', unitPrice: '250.00' }]

  it('defaults kind to INVOICE when omitted', () => {
    const parsed = brokerageInvoiceCreateSchema.parse({
      clientId: 'c1234567890',
      invoiceNumber: 'INV-001',
      items: baseItems,
    })
    expect(parsed.kind).toBe('INVOICE')
  })

  it('accepts QUOTE with an optional validUntil date', () => {
    const parsed = brokerageInvoiceCreateSchema.parse({
      clientId: 'c1234567890',
      kind: 'QUOTE',
      invoiceNumber: 'QUO-001',
      validUntil: '2026-09-30',
      items: baseItems,
    })
    expect(parsed.kind).toBe('QUOTE')
    expect(parsed.validUntil).toBeInstanceOf(Date)
  })

  it('rejects an unknown kind', () => {
    expect(() =>
      brokerageInvoiceCreateSchema.parse({
        clientId: 'c1234567890',
        kind: 'ESTIMATE',
        invoiceNumber: 'X-001',
        items: baseItems,
      }),
    ).toThrow()
  })

  it('requires a fresh invoice number when converting a quote', () => {
    expect(() => quoteConvertSchema.parse({})).toThrow()
    const parsed = quoteConvertSchema.parse({ invoiceNumber: 'INV-100' })
    expect(parsed.invoiceNumber).toBe('INV-100')
  })
})
