import { describe, expect, it } from 'vitest'
import { calculateBillingTotals } from '@/server/services/billing.service'

describe('brokerage invoice totals', () => {
  it('sums manually entered item VAT without applying an implicit rate', () => {
    const result = calculateBillingTotals([
      { description: 'Entry preparation', quantity: '2', unitPrice: '12.50', vatAmount: '1.75' },
      { description: 'Disbursement', quantity: '1', unitPrice: '10.00', vatAmount: '0' },
    ])

    // Subtotal = (2 × 12.50) + (1 × 10.00) = 35.00.
    // VAT = 1.75 + 0.00 = 1.75; total = 35.00 + 1.75 = 36.75.
    expect(result.items.map((item) => item.amount)).toEqual(['25.00', '10.00'])
    expect(result.items.map((item) => item.vatAmount)).toEqual(['1.75', '0.00'])
    expect(result.subtotal).toBe('35.00')
    expect(result.vatAmount).toBe('1.75')
    expect(result.total).toBe('36.75')
  })
})
