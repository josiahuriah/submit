/**
 * DATA-ACCESS SEAM — SHIPMENTS
 * -----------------------------------------------------------------------------
 * The single boundary between the UI and the backend. Pages import from here;
 * they never touch repositories, services or fetch() directly.
 *
 * These run on the SERVER (imported by Server Components), so they call the
 * service layer directly. `organizationId` always comes from the verified
 * session — never from a page prop or request input — and reaches the data
 * layer as a TenantClient, so every read here is org-scoped by construction.
 *
 * Field-name differences between the repository output and the UI's DTOs are
 * resolved by the mappers at the bottom of this file. Fix mismatches THERE,
 * never in the components.
 */
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth/session'
import { createTenantClient } from '@/lib/db/tenant-client'
import { shipmentsService } from '@/server/services/shipments.service'
import { NotFoundError } from '@/lib/errors'
import type {
  Page,
  ShipmentListItem,
  ShipmentHeader,
  ShipmentStatus,
  ShipmentTotals,
  InvoiceSummary,
} from '@/lib/types'

/** Session-scoped client. One per request; cheap (the pool is shared). */
async function scoped() {
  const claims = await requireSession()
  return createTenantClient(claims.orgId)
}

/** List shipments for the Shipments page. */
export async function listShipments(filters: { search?: string } = {}): Promise<Page<ShipmentListItem>> {
  const db = await scoped()
  const page = await shipmentsService.list(db, filters)
  return { rows: page.items.map(toShipmentListItem), nextCursor: page.nextCursor }
}

/**
 * Get one shipment (for the entry page header).
 *
 * A tenant-scoped read of another org's id finds nothing and the service
 * throws NotFoundError. Pages cannot return a status code, so that becomes
 * Next's 404 — which is also the right answer for a cross-tenant probe: it
 * reveals nothing about whether the id exists elsewhere.
 */
export async function getShipment(id: string): Promise<ShipmentHeader> {
  const db = await scoped()
  try {
    const shipment = await shipmentsService.get(db, id)
    return toShipmentHeader(shipment)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }
}

// --- mappers ----------------------------------------------------------------
// The repository returns Prisma rows; the UI consumes the DTOs in lib/types.
// Everything that differs between the two is reconciled here.

type ListRow = Awaited<ReturnType<typeof shipmentsService.list>>['items'][number]
type DetailRow = Awaited<ReturnType<typeof shipmentsService.get>>

/** "Marcus", "Rolle" -> "M. Rolle" — how brokers initial their own work. */
function initialled(user: { firstName: string; lastName: string } | null): string {
  if (!user) return '—'
  const initial = user.firstName.charAt(0)
  return initial ? `${initial}. ${user.lastName}` : user.lastName
}

/**
 * A shipment can carry several supplier invoices. The list shows the single
 * supplier when there is one and "Various" when there are more, which is how
 * the paper worksheets read.
 */
function supplierLabel(invoices: { supplier: { name: string } }[]): string {
  const names = [...new Set(invoices.map((i) => i.supplier.name))]
  if (names.length === 0) return '—'
  if (names.length === 1) return names[0]!
  return 'Various'
}

/** Dates cross to the client as plain ISO days; the UI formats them. */
function isoDay(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

function toShipmentListItem(row: ListRow): ShipmentListItem {
  return {
    id: row.id,
    shipmentNumber: row.shipmentNumber,
    blNumber: row.blNumber ?? '—',
    manifestNumber: row.manifest?.manifestNumber ?? '—',
    arrival: isoDay(row.manifest?.voyage?.arrivalDate),
    consigneeName: row.client.name,
    supplier: supplierLabel(row.invoices),
    description: row.description ?? '—',
    preparedBy: initialled(row.createdBy),
    status: row.status as ShipmentStatus,
  }
}

function toShipmentHeader(row: DetailRow): ShipmentHeader {
  return {
    id: row.id,
    shipmentNumber: row.shipmentNumber,
    blNumber: row.blNumber ?? '—',
    consigneeName: row.client.name,
    status: row.status as ShipmentStatus,
    totals: toShipmentTotals(row),
    freightCharge: String(row.freightCharge),
    insuranceCharge: String(row.insuranceCharge),
    invoice: toInvoiceSummary(row.invoices[0]),
    invoices: row.invoices.map((invoice) => toInvoiceSummary(invoice)!),
  }
}

function toInvoiceSummary(invoice: DetailRow['invoices'][number] | undefined): InvoiceSummary | null {
  if (!invoice) return null
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: isoDay(invoice.invoiceDate),
    supplierName: invoice.supplier.name,
    subTotal: String(invoice.subTotal),
    currency: invoice.currency,
    exchangeRate: String(invoice.exchangeRate),
    incotermCode: invoice.incotermCode,
    incotermLocation: invoice.incotermLocation,
  }
}

/**
 * calculatedAt is the engine's own marker that the roll-ups are current; any
 * line-item edit clears it. Without it the stored totals are stale, so we
 * report "not calculated" rather than showing numbers that no longer describe
 * the shipment.
 */
export function toShipmentTotals(row: {
  calculatedAt: Date | null
  totalCifValue: unknown
  totalDuty: unknown
  totalExcise: unknown
  totalLevy: unknown
  totalVat: unknown
  processingFee: unknown
  totalPayable: unknown
}): ShipmentTotals | null {
  if (!row.calculatedAt) return null
  return {
    cif: String(row.totalCifValue),
    duty: String(row.totalDuty),
    excise: String(row.totalExcise),
    levy: String(row.totalLevy),
    vat: String(row.totalVat),
    processingFee: String(row.processingFee),
    payable: String(row.totalPayable),
  }
}
