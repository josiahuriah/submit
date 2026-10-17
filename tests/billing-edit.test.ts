/** Service boundary checks: tenant scoping, payment guards, exact totals and clearing fields. */
import { describe, expect, it, vi } from 'vitest'
import type { TenantClient } from '@/lib/db/tenant-client'
import { billingService } from '@/server/services/billing.service'
import { brokerageInvoiceUpdateSchema } from '@/lib/validation/schemas'

function fixture(status = 'DRAFT', amountPaid = '0', payments: unknown[] = []) {
  const before = { id: 'invoice', status, amountPaid, payments, client: { id: 'client' } }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'invoice' }]),
    brokerageInvoice: {
      findFirst: vi.fn().mockResolvedValue(before),
      update: vi.fn().mockImplementation(async (args) => ({ ...before, ...args.data })),
    },
    client: { findFirst: vi.fn().mockResolvedValue({ id: 'client', isActive: true }) },
    shipment: { count: vi.fn().mockResolvedValue(0) },
  }
  const db = {
    $organizationId: 'org',
    $tenantTransaction: vi.fn().mockImplementation((fn) => fn(tx)),
    auditLog: { create: vi.fn() },
  }
  return { db: db as unknown as TenantClient, tx, audit: db.auditLog }
}
const input = {
  clientId: 'client', invoiceNumber: 'BILL-EDIT', dueDate: null,
  items: [
    { description: 'Brokerage', quantity: '2', unitPrice: '12.50', vatAmount: '1.75' },
    { description: 'Delivery', quantity: '1', unitPrice: '10.00', vatAmount: '0' },
  ],
}

describe('billing invoice edits', () => {
  it.each(['DRAFT', 'SENT'])('updates an unpaid %s invoice with manual VAT and clears optional fields', async (status) => {
    const { db, tx, audit } = fixture(status)
    const result = await billingService.update(db, { userId: 'user' }, 'invoice', input)
    // (2 × 12.50) + 10 = 35; explicit VAT 1.75; total 36.75.
    expect(result).toMatchObject({ subtotal: '35.00', vatAmount: '1.75', total: '36.75', dueDate: null, notes: null, paymentInstructions: null })
    expect(tx.brokerageInvoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'invoice', organizationId: 'org' } }))
    expect(tx.brokerageInvoice.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invoice', organizationId: 'org' },
      data: expect.objectContaining({ items: { deleteMany: {}, create: expect.arrayContaining([expect.objectContaining({ amount: '25.00', vatAmount: '1.75' })]) } }),
    }))
    expect(audit.create).toHaveBeenCalledOnce()
  })

  it.each(['PAID', 'PARTIALLY_PAID', 'VOID'])('rejects changes to %s invoices', async (status) => {
    const { db, tx } = fixture(status)
    await expect(billingService.update(db, { userId: 'user' }, 'invoice', input)).rejects.toThrow('without payments')
    expect(tx.brokerageInvoice.update).not.toHaveBeenCalled()
  })

  it('checks payments again after acquiring the lock', async () => {
    const { db, tx } = fixture('SENT', '1', [{ id: 'payment' }])
    await expect(billingService.update(db, { userId: 'user' }, 'invoice', input)).rejects.toThrow('without payments')
    expect(tx.brokerageInvoice.update).not.toHaveBeenCalled()
  })

  it('rejects an invoice outside the tenant before loading or editing it', async () => {
    const { db, tx } = fixture()
    tx.$queryRaw.mockResolvedValue([])
    await expect(billingService.update(db, { userId: 'user' }, 'other-invoice', input)).rejects.toThrow('not found')
    expect(tx.brokerageInvoice.findFirst).not.toHaveBeenCalled()
    expect(tx.brokerageInvoice.update).not.toHaveBeenCalled()
  })

  it('rejects a client outside the tenant', async () => {
    const { db, tx } = fixture()
    tx.client.findFirst.mockResolvedValue(null)
    await expect(billingService.update(db, { userId: 'user' }, 'invoice', input)).rejects.toThrow('Client not found')
    expect(tx.client.findFirst).toHaveBeenCalledWith({ where: { id: 'client', organizationId: 'org' } })
    expect(tx.brokerageInvoice.update).not.toHaveBeenCalled()
  })

  it('retains shipment associations only when they belong to the selected client and tenant', async () => {
    const { db, tx } = fixture()
    const linkedInput = { ...input, items: [{ ...input.items[0], shipmentId: 'shipment' }] }
    await expect(billingService.update(db, { userId: 'user' }, 'invoice', linkedInput)).rejects.toThrow('selected client')
    expect(tx.shipment.count).toHaveBeenCalledWith({ where: { id: { in: ['shipment'] }, clientId: 'client', organizationId: 'org' } })
    expect(tx.brokerageInvoice.update).not.toHaveBeenCalled()
  })

  it('saves payment instructions separately from notes and allows clearing them', async () => {
    const { db } = fixture()
    const result = await billingService.update(db, { userId: 'user' }, 'invoice', {
      ...input, notes: 'Thank you', paymentInstructions: 'Bank: Example Bank\nAccount: Atlas Brokers',
    })
    expect(result).toMatchObject({ notes: 'Thank you', paymentInstructions: 'Bank: Example Bank\nAccount: Atlas Brokers' })
    const cleared = await billingService.update(db, { userId: 'user' }, 'invoice', { ...input, paymentInstructions: '' })
    expect(cleared.paymentInstructions).toBeNull()
    expect(brokerageInvoiceUpdateSchema.safeParse({ ...input, paymentInstructions: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('accepts clearing the due date and rejects invalid or empty item data', () => {
    expect(brokerageInvoiceUpdateSchema.parse(input).dueDate).toBeNull()
    expect(brokerageInvoiceUpdateSchema.safeParse({ ...input, items: [] }).success).toBe(false)
    expect(brokerageInvoiceUpdateSchema.safeParse({ ...input, items: [{ ...input.items[0], vatAmount: '-1' }] }).success).toBe(false)
  })
})
