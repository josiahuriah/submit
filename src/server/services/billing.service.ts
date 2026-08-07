/**
 * Billing service — what the brokerage charges its clients.
 *
 * Money rules:
 *   - Item amount = quantity × unitPrice, computed server-side (never trust
 *     client-side arithmetic for money).
 *   - Invoice: subtotal = Σ item amounts; VAT applied at invoice level;
 *     total = subtotal + VAT.
 *   - Payments accumulate on amountPaid; status advances
 *     SENT → PARTIALLY_PAID → PAID automatically. Overpayment is rejected.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import { d, toMoney, moneyString, sum } from '@/lib/calculations/money'
import { cursorArgs, toPage, type PaginationParams } from '@/lib/db/pagination'

const INVOICE_SELECT = {
  id: true, kind: true, invoiceNumber: true, status: true, issueDate: true, dueDate: true,
  validUntil: true, subtotal: true, vatAmount: true, total: true, amountPaid: true, notes: true,
  convertedFromId: true,
  client: { select: { id: true, name: true } },
  items: {
    select: { id: true, description: true, quantity: true, unitPrice: true, amount: true, shipmentId: true },
  },
  payments: {
    select: { id: true, amount: true, method: true, reference: true, receivedAt: true },
    orderBy: { receivedAt: 'desc' as const },
  },
  convertedTo: { select: { id: true, invoiceNumber: true } },
} as const

export interface BrokerageInvoiceInput {
  clientId: string
  kind?: 'INVOICE' | 'QUOTE'
  invoiceNumber: string
  dueDate?: Date
  validUntil?: Date
  vatRate: string
  notes?: string
  items: { description: string; shipmentId?: string; quantity: string; unitPrice: string }[]
}

export const billingService = {
  async list(db: TenantClient, params: PaginationParams & { kind?: string; status?: string; clientId?: string }) {
    const rows = await db.brokerageInvoice.findMany({
      where: {
        ...(params.kind ? { kind: params.kind as never } : {}),
        ...(params.status ? { status: params.status as never } : {}),
        ...(params.clientId ? { clientId: params.clientId } : {}),
      },
      select: INVOICE_SELECT,
      orderBy: { issueDate: 'desc' },
      ...cursorArgs(params),
    })
    return toPage(rows, params)
  },

  async get(db: TenantClient, invoiceId: string) {
    const invoice = await db.brokerageInvoice.findUnique({ where: { id: invoiceId }, select: INVOICE_SELECT })
    if (!invoice) throw new NotFoundError('Brokerage invoice')
    return invoice
  },

  async create(db: TenantClient, audit: AuditContext, input: BrokerageInvoiceInput) {
    const client = await db.client.findUnique({ where: { id: input.clientId }, select: { id: true } })
    if (!client) throw new NotFoundError('Client')

    const items = input.items.map((item) => ({
      description: item.description,
      shipmentId: item.shipmentId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: moneyString(d(item.quantity).times(d(item.unitPrice))),
    }))
    const subtotal = toMoney(sum(items.map((i) => i.amount)))
    const vatAmount = toMoney(subtotal.times(d(input.vatRate)))
    const total = toMoney(subtotal.plus(vatAmount))

    const kind = input.kind ?? 'INVOICE'
    const invoice = await db.brokerageInvoice.create({
      data: {
        clientId: input.clientId,
        kind,
        invoiceNumber: input.invoiceNumber,
        dueDate: input.dueDate,
        validUntil: input.validUntil,
        notes: input.notes,
        subtotal: moneyString(subtotal),
        vatAmount: moneyString(vatAmount),
        total: moneyString(total),
        items: { create: items },
      } as never,
      select: INVOICE_SELECT,
    })
    await writeAudit(db, audit, { action: 'CREATE', entityType: 'BrokerageInvoice', entityId: invoice.id })
    return invoice
  },

  /**
   * Convert an accepted QUOTE into a billable INVOICE. The line items and
   * frozen totals are copied verbatim so the amount the client agreed to is
   * exactly what they are billed; the new invoice links back to its source
   * quote (1:1). A quote can be converted only once.
   */
  async convertToInvoice(
    db: TenantClient,
    audit: AuditContext,
    quoteId: string,
    input: { invoiceNumber: string; dueDate?: Date },
  ) {
    const quote = await this.get(db, quoteId)
    if (quote.kind !== 'QUOTE') throw new BusinessRuleError('Only a quote can be converted to an invoice')
    if (quote.convertedTo) {
      throw new BusinessRuleError(`This quote was already converted to invoice ${quote.convertedTo.invoiceNumber}`)
    }

    const invoice = await db.brokerageInvoice.create({
      data: {
        clientId: quote.client.id,
        kind: 'INVOICE',
        invoiceNumber: input.invoiceNumber,
        dueDate: input.dueDate,
        notes: quote.notes,
        subtotal: moneyString(d(String(quote.subtotal))),
        vatAmount: moneyString(d(String(quote.vatAmount))),
        total: moneyString(d(String(quote.total))),
        convertedFromId: quote.id,
        items: {
          create: quote.items.map((item) => ({
            description: item.description,
            shipmentId: item.shipmentId,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
            amount: moneyString(d(String(item.amount))),
          })),
        },
      } as never,
      select: INVOICE_SELECT,
    })
    await writeAudit(db, audit, {
      action: 'CREATE', entityType: 'BrokerageInvoice', entityId: invoice.id,
      changes: { after: { convertedFromQuoteId: quote.id } },
    })
    return invoice
  },

  async send(db: TenantClient, audit: AuditContext, invoiceId: string) {
    const invoice = await this.get(db, invoiceId)
    if (invoice.status !== 'DRAFT') throw new BusinessRuleError('Only DRAFT invoices can be sent')
    const updated = await db.brokerageInvoice.update({
      where: { id: invoiceId },
      data: { status: 'SENT' },
      select: INVOICE_SELECT,
    })
    await writeAudit(db, audit, {
      action: 'STATUS_CHANGE', entityType: 'BrokerageInvoice', entityId: invoiceId,
      changes: { before: { status: 'DRAFT' }, after: { status: 'SENT' } },
    })
    return updated
  },

  async recordPayment(
    db: TenantClient,
    audit: AuditContext,
    input: { brokerageInvoiceId: string; amount: string; method: string; reference?: string; receivedAt?: Date },
  ) {
    const invoice = await this.get(db, input.brokerageInvoiceId)
    if (invoice.kind === 'QUOTE') {
      throw new BusinessRuleError('Cannot record a payment against a quote; convert it to an invoice first')
    }
    if (invoice.status === 'VOID') throw new BusinessRuleError('Cannot record a payment on a VOID invoice')
    if (invoice.status === 'DRAFT') throw new BusinessRuleError('Send the invoice before recording payments')

    const paid = d(String(invoice.amountPaid))
    const total = d(String(invoice.total))
    const amount = d(input.amount)
    if (amount.lessThanOrEqualTo(0)) throw new BusinessRuleError('Payment amount must be positive')

    const newPaid = toMoney(paid.plus(amount))
    if (newPaid.greaterThan(total)) {
      throw new BusinessRuleError(
        `Payment of ${moneyString(amount)} would exceed the outstanding balance of ${moneyString(total.minus(paid))}`,
      )
    }

    const nextStatus = newPaid.equals(total) ? 'PAID' : 'PARTIALLY_PAID'

    // Payment insert + running total must commit together.
    await db.$tenantTransaction(async (tx) => {
      await tx.payment.create({
        data: {
          organizationId: db.$organizationId,
          brokerageInvoiceId: input.brokerageInvoiceId,
          amount: moneyString(amount),
          method: input.method as never,
          reference: input.reference,
          receivedAt: input.receivedAt ?? new Date(),
        },
      })
      await tx.brokerageInvoice.update({
        where: { id: input.brokerageInvoiceId },
        data: { amountPaid: moneyString(newPaid), status: nextStatus },
      })
    })

    await writeAudit(db, audit, {
      action: 'UPDATE', entityType: 'BrokerageInvoice', entityId: input.brokerageInvoiceId,
      changes: { after: { event: 'PAYMENT', amount: moneyString(amount), status: nextStatus } },
    })

    return this.get(db, input.brokerageInvoiceId)
  },
}
