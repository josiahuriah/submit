/**
 * DATA-ACCESS SEAM — LINE ITEMS & HS CODES
 * -----------------------------------------------------------------------------
 * Same pattern as shipments.ts: the only place the UI meets the backend.
 *
 * Two different scoping rules apply here, deliberately:
 *   - Line items are TENANT data, read through a session-scoped TenantClient.
 *   - HS codes are GLOBAL reference data shared by every brokerage, so
 *     hsCodesService reads them via basePrisma. There is nothing tenant-specific
 *     to leak, but the search is still only reachable behind an authenticated
 *     route (see /api/hs-codes/search).
 */
'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { invoicesService } from '@/server/services/invoices.service'
import { hsCodesService } from '@/server/services/hs-codes.service'
import { calculationsService } from '@/server/services/calculations.service'
import { lineItemCreateSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'
import { toShipmentTotals } from '@/lib/data/shipments'
import type { HsRate, LineItem, ServerLineCharges, ShipmentTotals } from '@/lib/types'

/** Every line on a shipment, priced by the server where a calculation exists. */
export async function getLineItems(shipmentId: string): Promise<LineItem[]> {
  const claims = await requireSession()
  const db = createTenantClient(claims.orgId)
  const rows = await invoicesService.listLineItemsForShipment(db, shipmentId)
  return rows.map(toLineItem)
}

/**
 * Search HS codes by code or description. Description matching rides the
 * pg_trgm GIN index on HSCode.description; the service memoizes recent queries,
 * and the caller debounces, so keystrokes don't each become a query.
 */
export async function searchHsCodes(query: string): Promise<HsRate[]> {
  const results = await hsCodesService.search(query, 8)
  return results.map(toHsRate)
}

/** Look up one code's rates — used when the entry row picks a code. */
export async function findHsRate(code: string): Promise<HsRate | null> {
  const results = await hsCodesService.search(code, 1)
  const hit = results.find((r) => r.code === code)
  return hit ? toHsRate(hit) : null
}

// --- mutations --------------------------------------------------------------
// Server Actions. They repeat the guarantees withAuth() gives route handlers,
// because an action is a POST endpoint of its own: verified session, RBAC
// check, tenant-scoped client, audit context. None of it is inferable from
// the caller, so none of it may be skipped here.

async function writeContext(permission: 'shipments:write') {
  const claims = await requireSession()
  requirePermission(claims.role, permission)
  const headerList = await headers()
  return {
    db: createTenantClient(claims.orgId),
    audit: {
      userId: claims.sub,
      ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerList.get('user-agent') ?? undefined,
    },
  }
}

export interface CommitLineResult {
  lines: LineItem[]
  /**
   * Shipment roll-ups from the engine. The ledger shows THESE, not a sum of
   * `lines` — the processing fee and its VAT are shipment-level and belong to
   * no line, so a line sum under-reports the total payable.
   */
  totals: ShipmentTotals | null
  /** Set when the line saved but the shipment could not be repriced. */
  calculationError: string | null
  /**
   * Set when the operation itself was refused (e.g. the shipment is no longer
   * DRAFT). Returned as DATA rather than thrown: Next.js redacts the message of
   * anything thrown across a Server Action boundary in a production build, so a
   * throw reaches the user as "an error occurred" with no cause. Expected,
   * explainable failures must travel as values.
   */
  error: string | null
}

const TOTALS_SELECT = {
  calculatedAt: true,
  totalCifValue: true,
  totalDuty: true,
  totalExcise: true,
  totalLevy: true,
  totalVat: true,
  processingFee: true,
  totalPayable: true,
} as const

/** Re-read lines + roll-ups after a mutation so the client never guesses. */
async function refreshed(
  db: ReturnType<typeof createTenantClient>,
  shipmentId: string,
  calculationError: string | null,
): Promise<CommitLineResult> {
  const [rows, shipment] = await Promise.all([
    invoicesService.listLineItemsForShipment(db, shipmentId),
    db.shipment.findUnique({ where: { id: shipmentId }, select: TOTALS_SELECT }),
  ])
  return {
    lines: rows.map(toLineItem),
    totals: shipment ? toShipmentTotals(shipment) : null,
    calculationError,
    error: null,
  }
}

/** Current state plus an explanation, for an operation that was refused. */
async function refused(
  db: ReturnType<typeof createTenantClient>,
  shipmentId: string,
  error: string,
): Promise<CommitLineResult> {
  const current = await refreshed(db, shipmentId, null)
  return { ...current, error }
}

/**
 * Commit one line, then reprice the shipment so the caller gets AUTHORITATIVE
 * numbers rather than the client's preview.
 *
 * Creating a line clears the shipment's calculatedAt, so the line exists
 * unpriced for a moment; the calculate call is what fills in duty/VAT/levy/
 * excise via the real engine. Calculation legitimately refuses in some states
 * (a line with no HS code, a non-DRAFT shipment). That is not a failed save —
 * the line is committed either way — so it is reported, not thrown.
 */
export async function commitLineItem(
  shipmentId: string,
  draft: {
    hsCode: string
    quantity: string
    unit: string
    description: string
    cpcCode: string
    unitPrice: string
  },
): Promise<CommitLineResult> {
  const { db, audit } = await writeContext('shipments:write')

  const invoice = await db.invoice.findFirst({
    where: { shipmentId },
    select: { id: true },
    orderBy: { invoiceDate: 'asc' },
  })
  if (!invoice) {
    return refused(db, shipmentId, 'This shipment has no supplier invoice yet — add one before entering lines.')
  }

  // The HS code is matched to a real tariff line so the engine can resolve its
  // rate; without hsCodeId, calculation refuses the whole shipment.
  const hs = await hsCodesService.search(draft.hsCode, 1)
  const matched = hs.find((h) => h.code === draft.hsCode)

  const quantity = Number(draft.quantity) || 1
  const unitPrice = Number(draft.unitPrice) || 0

  const input = lineItemCreateSchema.parse({
    invoiceId: invoice.id,
    hsCodeId: matched?.id,
    hsCode: draft.hsCode,
    cpcCode: draft.cpcCode.trim().toUpperCase() || '4000',
    description: draft.description || matched?.description || draft.hsCode,
    quantity: String(quantity),
    unit: draft.unit || 'PCS',
    unitPrice: unitPrice.toFixed(4),
    totalValue: (quantity * unitPrice).toFixed(2),
  })

  try {
    await invoicesService.createLineItem(db, audit, input)
  } catch (error) {
    // Business rules (shipment no longer DRAFT, unknown HS code) are expected
    // outcomes the broker can act on — surface the reason, not a generic error.
    if (error instanceof AppError) return refused(db, shipmentId, error.message)
    throw error
  }

  let calculationError: string | null = null
  try {
    await calculationsService.calculate(db, audit, shipmentId, { apportionmentBasis: 'VALUE' })
  } catch (error) {
    calculationError = error instanceof Error ? error.message : 'Could not reprice the shipment'
  }

  return refreshed(db, shipmentId, calculationError)
}

/** Delete a line and reprice what remains. */
export async function deleteLineItem(
  shipmentId: string,
  lineItemId: string,
): Promise<CommitLineResult> {
  const { db, audit } = await writeContext('shipments:write')
  try {
    await invoicesService.deleteLineItem(db, audit, lineItemId)
  } catch (error) {
    if (error instanceof AppError) return refused(db, shipmentId, error.message)
    throw error
  }

  let calculationError: string | null = null
  try {
    await calculationsService.calculate(db, audit, shipmentId, { apportionmentBasis: 'VALUE' })
  } catch (error) {
    // Removing the last line leaves nothing to calculate — expected, not an error.
    calculationError = error instanceof Error ? error.message : 'Could not reprice the shipment'
  }

  return refreshed(db, shipmentId, calculationError)
}

// --- mappers ----------------------------------------------------------------

type LineRow = Awaited<ReturnType<typeof invoicesService.listLineItemsForShipment>>[number]
type HsRow = Awaited<ReturnType<typeof hsCodesService.search>>[number]

/** Prisma Decimal (or null) -> plain string, preserving every digit. */
function dec(value: unknown): string {
  return value === null || value === undefined ? '0' : String(value)
}

function num(value: unknown): number {
  return Number(dec(value))
}

/**
 * Charges are present only once the shipment has been calculated. cifValue is
 * the engine's first output, so it doubles as the "has been priced" marker —
 * a created-but-unpriced line has cifValue 0 and all-zero amounts.
 */
function toCharges(row: LineRow): ServerLineCharges | null {
  const cif = num(row.cifValue)
  const amounts = [row.dutyAmount, row.vatAmount, row.levyAmount, row.exciseAmount].map(num)
  if (cif === 0 && amounts.every((a) => a === 0)) return null

  const payable = amounts.reduce((total, a) => total + a, 0)
  return {
    fob: dec(row.totalValue),
    cif: dec(row.cifValue),
    duty: dec(row.dutyAmount),
    excise: dec(row.exciseAmount),
    levy: dec(row.levyAmount),
    vat: dec(row.vatAmount),
    // Summed from the engine's own per-tax amounts; not a re-derivation.
    payable: payable.toFixed(2),
  }
}

function toLineItem(row: LineRow): LineItem {
  return {
    id: row.id,
    hsCode: row.hsCode,
    quantity: num(row.quantity),
    unit: row.unit,
    description: row.description,
    cpcCode: row.cpcCode,
    unitPrice: num(row.unitPrice),
    pageNumber: row.pageNumber,
    hsDescription: row.commercialDescription ?? undefined,
    charges: toCharges(row),
    rates: { duty: dec(row.dutyRate), vat: dec(row.vatRate) },
  }
}

/**
 * The preview calculator wants plain fractions. Excise is carried as the
 * ad-valorem fraction only; SPECIFIC and COMPOUND bases cannot be previewed
 * client-side and are left to the server (see lib/calc.ts).
 */
function toHsRate(row: HsRow): HsRate {
  const rate = row.currentRate
  return {
    code: row.code,
    description: row.description,
    duty: rate ? num(rate.dutyRate) : 0,
    vat: rate ? num(rate.vatRate) : 0,
    levy: rate ? num(rate.levyRate) : 0,
    excise: rate ? num(rate.exciseRate) : 0,
  }
}
