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
  id: true, invoiceNumber: true, status: true, issueDate: true, dueDate: true,
  subtotal: true, vatAmount: true, total: true, amountPaid: true, notes: true,
  client: { select: { id: true, name: true } },
  items: {
    select: { id: true, description: true, quantity: true, unitPrice: true, amount: true, shipmentId: true },
  },
  payments: {
    select: { id: true, amount: true, method: true, reference: true, receivedAt: true },
    orderBy: { receivedAt: 'desc' as const },
  },
} as const

export interface BrokerageInvoiceInput {
  clientId: string
  invoiceNumber: string
  dueDate?: Date
  vatRate: string
  notes?: string
  items: { description: string; shipmentId?: string; quantity: string; unitPrice: string }[]
}

export const billingService = {
  async list(db: TenantClient, params: PaginationParams & { status?: string; clientId?: string }) {
    const rows = await db.brokerageInvoice.findMany({
      where: {
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
    const client = await db.client.findUnique({ where: { id: input.clientId }, select: { id: true, isActive: true } })
    if (!client) throw new NotFoundError('Client')
    if (!client.isActive) throw new BusinessRuleError('Cannot raise a new invoice for an inactive client')

    const shipmentIds = [...new Set(input.items.flatMap((item) => item.shipmentId ? [item.shipmentId] : []))]
    if (shipmentIds.length) {
      const matchingShipments = await db.shipment.count({
        where: { id: { in: shipmentIds }, clientId: input.clientId },
      })
      if (matchingShipments !== shipmentIds.length) {
        throw new BusinessRuleError('Every billed shipment must belong to the selected client')
      }
    }

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

    const invoice = await db.brokerageInvoice.create({
      data: {
        clientId: input.clientId,
        invoiceNumber: input.invoiceNumber,
        dueDate: input.dueDate,
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
    const amount = d(input.amount)
    if (amount.lessThanOrEqualTo(0)) throw new BusinessRuleError('Payment amount must be positive')

    // Lock before re-reading the balance. Without the row lock, two requests
    // can both validate against the same amountPaid and silently overpay or
    // lose one update even though each request uses a transaction.
    const updated = await db.$tenantTransaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "BrokerageInvoice"
        WHERE "id" = ${input.brokerageInvoiceId}
          AND "organizationId" = ${db.$organizationId}
        FOR UPDATE
      `
      if (locked.length === 0) throw new NotFoundError('Brokerage invoice')

      const invoice = await tx.brokerageInvoice.findUnique({
        where: { id: input.brokerageInvoiceId },
        select: { status: true, amountPaid: true, total: true },
      })
      if (!invoice) throw new NotFoundError('Brokerage invoice')
      if (invoice.status === 'VOID') throw new BusinessRuleError('Cannot record a payment on a VOID invoice')
      if (invoice.status === 'DRAFT') throw new BusinessRuleError('Send the invoice before recording payments')

      const paid = d(String(invoice.amountPaid))
      const total = d(String(invoice.total))
      const newPaid = toMoney(paid.plus(amount))
      if (newPaid.greaterThan(total)) {
        throw new BusinessRuleError(
          `Payment of ${moneyString(amount)} would exceed the outstanding balance of ${moneyString(total.minus(paid))}`,
        )
      }
      const nextStatus = newPaid.equals(total) ? 'PAID' : 'PARTIALLY_PAID'

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
      return { nextStatus, invoice: await tx.brokerageInvoice.findUnique({ where: { id: input.brokerageInvoiceId }, select: INVOICE_SELECT }) }
    })

    await writeAudit(db, audit, {
      action: 'UPDATE', entityType: 'BrokerageInvoice', entityId: input.brokerageInvoiceId,
      changes: { after: { event: 'PAYMENT', amount: moneyString(amount), status: updated.nextStatus } },
    })

    return updated.invoice
  },
}
