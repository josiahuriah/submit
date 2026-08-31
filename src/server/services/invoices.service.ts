/**
 * Invoices & line items service.
 *
 * Line numbering: lineNumber is assigned server-side (max+1 per invoice) so
 * clients can't create duplicate or gapped numbering; the (invoiceId,
 * lineNumber) unique constraint is the last line of defense.
 *
 * Any mutation here invalidates the shipment's calculation — we clear
 * calculatedAt so the submit precondition ("calculated since last change")
 * fails until the broker recalculates.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'

const INVOICE_SELECT = {
  id: true, invoiceNumber: true, invoiceDate: true, currency: true, exchangeRate: true,
  incotermCode: true, incotermLocation: true, subTotal: true,
  shipmentId: true,
  supplier: { select: { id: true, name: true } },
  _count: { select: { lineItems: true } },
} as const

const LINE_SELECT = {
  id: true, invoiceId: true, invoice: { select: { invoiceNumber: true } }, lineNumber: true, description: true,
  commercialDescription: true, pageNumber: true, hsCode: true, hsCodeId: true,
  cpcCode: true,
  quantity: true, unit: true, unitPrice: true, totalValue: true, weightLb: true,
  netWeightLb: true, countryOfOrigin: true, exemptionType: true, exemptionRef: true,
  packageCount: true, packageTypeCode: true, unitsPerPackage: true,
  unitVolume: true, volumeUnit: true, alcoholStrength: true, alcoholStrengthBasis: true,
  fobValueBsd: true, cifValue: true, dutyAmount: true, vatAmount: true, levyAmount: true, exciseAmount: true,
  freightApportioned: true, insuranceApportioned: true, otherCostApportioned: true,
  dutyBasis: true, dutyRate: true, specificRate: true, specificRateUnit: true,
  dutyAssessmentQuantity: true, vatRate: true, levyRate: true,
  exciseBasis: true, exciseRate: true, exciseSpecificRate: true,
  exciseSpecificRateUnit: true, exciseAssessmentQuantity: true,
} as const

async function assertShipmentEditable(db: TenantClient, shipmentId: string) {
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, status: true },
  })
  if (!shipment) throw new NotFoundError('Shipment')
  if (shipment.status !== 'DRAFT') {
    throw new BusinessRuleError('Invoices and line items can only change while the shipment is DRAFT')
  }
  return shipment
}

async function invalidateCalculation(db: TenantClient, shipmentId: string) {
  await db.shipment.update({ where: { id: shipmentId }, data: { calculatedAt: null } })
}

export const invoicesService = {
  async listForShipment(db: TenantClient, shipmentId: string) {
    return db.invoice.findMany({
      where: { shipmentId },
      select: INVOICE_SELECT,
      orderBy: { invoiceDate: 'asc' },
    })
  },

  async createInvoice(db: TenantClient, audit: AuditContext, data: {
    shipmentId: string
    supplierId: string
    invoiceNumber: string
    invoiceDate: Date
    currency?: string
    exchangeRate?: string
    incotermCode?: string
    incotermLocation?: string
    subTotal?: string
  }) {
    await assertShipmentEditable(db, data.shipmentId)
    const invoice = await db.invoice.create({ data: data as never, select: INVOICE_SELECT })
    await invalidateCalculation(db, data.shipmentId)
    await writeAudit(db, audit, { action: 'CREATE', entityType: 'Invoice', entityId: invoice.id })
    return invoice
  },

  async updateInvoice(db: TenantClient, audit: AuditContext, invoiceId: string, data: Record<string, unknown>) {
    const existing = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, shipmentId: true } })
    if (!existing) throw new NotFoundError('Invoice')
    await assertShipmentEditable(db, existing.shipmentId)
    const invoice = await db.invoice.update({ where: { id: invoiceId }, data: data as never, select: INVOICE_SELECT })
    await invalidateCalculation(db, existing.shipmentId)
    await writeAudit(db, audit, { action: 'UPDATE', entityType: 'Invoice', entityId: invoiceId })
    return invoice
  },

  async deleteInvoice(db: TenantClient, audit: AuditContext, invoiceId: string) {
    const existing = await db.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, shipmentId: true } })
    if (!existing) throw new NotFoundError('Invoice')
    await assertShipmentEditable(db, existing.shipmentId)
    await db.invoice.delete({ where: { id: invoiceId } }) // cascades to line items
    await invalidateCalculation(db, existing.shipmentId)
    await writeAudit(db, audit, { action: 'DELETE', entityType: 'Invoice', entityId: invoiceId })
  },

  // --- line items -------------------------------------------------------------

  async listLineItems(db: TenantClient, invoiceId: string) {
    return db.lineItem.findMany({
      where: { invoiceId },
      select: LINE_SELECT,
      orderBy: { lineNumber: 'asc' },
    })
  },

  /**
   * Every line on a shipment, across all of its supplier invoices — the entry
   * screen works per shipment, not per invoice. Ordered by invoice date then
   * line number so the sequence matches the paper the broker is keying from.
   */
  async listLineItemsForShipment(db: TenantClient, shipmentId: string) {
    return db.lineItem.findMany({
      where: { invoice: { shipmentId } },
      select: LINE_SELECT,
      orderBy: [{ invoice: { invoiceDate: 'asc' } }, { lineNumber: 'asc' }],
    })
  },

  async createLineItem(db: TenantClient, audit: AuditContext, data: Record<string, unknown> & { invoiceId: string }) {
    const invoice = await db.invoice.findUnique({
      where: { id: data.invoiceId },
      select: { id: true, shipmentId: true },
    })
    if (!invoice) throw new NotFoundError('Invoice')
    await assertShipmentEditable(db, invoice.shipmentId)

    // hsCodeId is optional at entry time but must reference a real code.
    if (data.hsCodeId) {
      const hs = await db.hSCode.findUnique({ where: { id: data.hsCodeId as string }, select: { id: true } })
      if (!hs) throw new NotFoundError('HS code')
    }

    const last = await db.lineItem.findFirst({
      where: { invoiceId: data.invoiceId },
      select: { lineNumber: true },
      orderBy: { lineNumber: 'desc' },
    })
    const line = await db.lineItem.create({
      data: { ...data, lineNumber: (last?.lineNumber ?? 0) + 1 } as never,
      select: LINE_SELECT,
    })
    await invalidateCalculation(db, invoice.shipmentId)
    await writeAudit(db, audit, { action: 'CREATE', entityType: 'LineItem', entityId: line.id })
    return line
  },

  async updateLineItem(db: TenantClient, audit: AuditContext, lineItemId: string, data: Record<string, unknown>) {
    const existing = await db.lineItem.findUnique({
      where: { id: lineItemId },
      select: { id: true, invoice: { select: { shipmentId: true } } },
    })
    if (!existing) throw new NotFoundError('Line item')
    await assertShipmentEditable(db, existing.invoice.shipmentId)
    const line = await db.lineItem.update({ where: { id: lineItemId }, data: data as never, select: LINE_SELECT })
    await invalidateCalculation(db, existing.invoice.shipmentId)
    await writeAudit(db, audit, { action: 'UPDATE', entityType: 'LineItem', entityId: lineItemId })
    return line
  },

  async deleteLineItem(db: TenantClient, audit: AuditContext, lineItemId: string) {
    const existing = await db.lineItem.findUnique({
      where: { id: lineItemId },
      select: { id: true, invoice: { select: { shipmentId: true } } },
    })
    if (!existing) throw new NotFoundError('Line item')
    await assertShipmentEditable(db, existing.invoice.shipmentId)
    await db.lineItem.delete({ where: { id: lineItemId } })
    await invalidateCalculation(db, existing.invoice.shipmentId)
    await writeAudit(db, audit, { action: 'DELETE', entityType: 'LineItem', entityId: lineItemId })
  },
}
