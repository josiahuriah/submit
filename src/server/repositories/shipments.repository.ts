/**
 * Shipments repository — the canonical repository pattern for this codebase.
 *
 * Repository responsibilities (and nothing else):
 *   - Shape queries: `select` over `include` (only fetch what the caller
 *     needs — smaller payloads, no accidental N+1 relations).
 *   - Cursor pagination via the shared helpers.
 *   - No business rules, no HTTP, no audit — that's the service layer.
 *
 * Every method takes a TenantClient, so tenant scoping is already guaranteed
 * before this code runs (see tenant-client.ts).
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { cursorArgs, toPage, type Page, type PaginationParams } from '@/lib/db/pagination'
import type { ShipmentStatus, TransportMode } from '@/generated/prisma/enums'

const LIST_SELECT = {
  id: true,
  shipmentNumber: true,
  status: true,
  transportMode: true,
  blNumber: true,
  description: true,
  packageCount: true,
  totalCifValue: true,
  totalPayable: true,
  calculatedAt: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
  // voyage.arrivalDate is the "arrival" column on the shipments list; supplier
  // names and the preparer are shown alongside it. All three are one hop from
  // the shipment, so they ride along rather than costing a second query.
  manifest: {
    select: {
      id: true,
      manifestNumber: true,
      voyage: { select: { arrivalDate: true } },
    },
  },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  invoices: { select: { supplier: { select: { name: true } } } },
} as const

const DETAIL_SELECT = {
  ...LIST_SELECT,
  goodsType: true,
  packageType: true,
  containerNumber: true,
  containerSealNumber: true,
  containerFullnessCode: true,
  declarationDate: true,
  declarationFunctionCode: true,
  regimeCode: true,
  goodsLocationCode: true,
  warehouseCode: true,
  transportNationalityCode: true,
  grossWeightKg: true,
  netWeightKg: true,
  freightCharge: true,
  insuranceCharge: true,
  otherCharges: true,
  totalFobValue: true,
  totalDuty: true,
  totalVat: true,
  totalLevy: true,
  totalExcise: true,
  processingFee: true,
  submittedAt: true,
  clearedAt: true,
  declarationOffice: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  invoices: {
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      currency: true,
      exchangeRate: true,
      incotermCode: true,
      incotermLocation: true,
      subTotal: true,
      supplier: { select: { id: true, name: true } },
      _count: { select: { lineItems: true } },
    },
    orderBy: { invoiceDate: 'asc' as const },
  },
  customsEntries: {
    select: {
      id: true,
      entryNumber: true,
      declarationType: true,
      status: true,
      beaipReference: true,
      submittedAt: true,
      totalPayable: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  documents: {
    select: { id: true, fileName: true, documentType: true, sizeBytes: true, createdAt: true },
  },
} as const

export interface ShipmentListFilters extends PaginationParams {
  status?: ShipmentStatus
  clientId?: string
  search?: string
}

export const shipmentsRepository = {
  async list(db: TenantClient, filters: ShipmentListFilters) {
    const rows = await db.shipment.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.clientId ? { clientId: filters.clientId } : {}),
        ...(filters.search
          ? {
              OR: [
                { shipmentNumber: { contains: filters.search, mode: 'insensitive' } },
                { blNumber: { contains: filters.search, mode: 'insensitive' } },
                // description search rides the pg_trgm GIN index
                { description: { contains: filters.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: LIST_SELECT,
      orderBy: { createdAt: 'desc' }, // matches [organizationId, status, createdAt desc] index
      ...cursorArgs(filters),
    })
    return toPage(rows, filters) as Page<(typeof rows)[number]>
  },

  async byId(db: TenantClient, shipmentId: string) {
    return db.shipment.findUnique({
      where: { id: shipmentId },
      select: DETAIL_SELECT,
    })
  },

  async create(
    db: TenantClient,
    data: {
      shipmentNumber: string
      clientId: string
      createdById: string
      declarationOfficeId: string
      manifestId?: string
      goodsType?: string
      packageType?: string
      packageCount?: number
      transportMode?: TransportMode
      blNumber?: string
      containerNumber?: string
      description?: string
      grossWeightKg?: string
      freightCharge?: string
      insuranceCharge?: string
      otherCharges?: string
    },
  ) {
    return db.shipment.create({ data: data as never, select: DETAIL_SELECT })
  },

  async update(db: TenantClient, shipmentId: string, data: Record<string, unknown>) {
    return db.shipment.update({
      where: { id: shipmentId },
      data: data as never,
      select: DETAIL_SELECT,
    })
  },

  async delete(db: TenantClient, shipmentId: string) {
    return db.shipment.delete({ where: { id: shipmentId }, select: { id: true } })
  },

  /** Full line-item graph needed by the calculation engine. */
  async withLineItemsForCalculation(db: TenantClient, shipmentId: string) {
    return db.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        declarationDate: true,
        freightCharge: true,
        insuranceCharge: true,
        otherCharges: true,
        invoices: {
          select: {
            id: true,
            exchangeRate: true,
            lineItems: {
              select: {
                id: true,
                hsCodeId: true,
                hsCode: true,
                quantity: true,
                unit: true,
                totalValue: true,
                weightKg: true,
                unitsPerPackage: true,
                unitVolume: true,
                volumeUnit: true,
                alcoholStrength: true,
                alcoholStrengthBasis: true,
                exemptionType: true,
              },
              orderBy: { lineNumber: 'asc' },
            },
          },
        },
      },
    })
  },
}
