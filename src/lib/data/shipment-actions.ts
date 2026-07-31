/**
 * DATA-ACCESS SEAM — SHIPMENT MUTATIONS
 * -----------------------------------------------------------------------------
 * Server Actions for creating and submitting shipments, plus the reference
 * reads the new-shipment form needs. Kept apart from shipments.ts because a
 * 'use server' file may only export async functions, and shipments.ts exports
 * the toShipmentTotals mapper.
 *
 * Same guarantees as line-items.ts actions: verified session, RBAC check,
 * tenant-scoped client, audit context — an action is a POST endpoint of its
 * own, so none of this is inferable from the caller.
 */
'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission, type Permission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { basePrisma } from '@/lib/db/prisma'
import { shipmentsService } from '@/server/services/shipments.service'
import { declarationsService } from '@/server/services/declarations.service'
import { catalogService } from '@/server/services/catalog.service'
import { shipmentCreateSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'

async function actionContext(permission: Permission) {
  const claims = await requireSession()
  requirePermission(claims.role, permission)
  const headerList = await headers()
  return {
    claims,
    db: createTenantClient(claims.orgId),
    audit: {
      userId: claims.sub,
      ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerList.get('user-agent') ?? undefined,
    },
  }
}

// --- reference reads for the new-shipment form -------------------------------

export interface OptionItem {
  id: string
  label: string
}

export interface NewShipmentOptions {
  clients: OptionItem[]
  offices: OptionItem[]
  manifests: OptionItem[]
}

export async function listNewShipmentOptions(): Promise<NewShipmentOptions> {
  const claims = await requireSession()
  const db = createTenantClient(claims.orgId)
  const [clients, offices, manifests] = await Promise.all([
    catalogService.listClients(db, {}),
    basePrisma.customsOffice.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    }),
    catalogService.listManifests(db, {}),
  ])
  return {
    clients: clients.items.map((c) => ({ id: c.id, label: c.name })),
    offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })),
    manifests: manifests.items.map((m) => ({
      id: m.id,
      label: `${m.manifestNumber} · ${m.voyage.vessel.name} ${m.voyage.voyageNumber}`,
    })),
  }
}

// --- create ------------------------------------------------------------------

/** Next org-scoped number in the SHP-YYYY-NNNNN series. */
async function nextShipmentNumber(db: ReturnType<typeof createTenantClient>): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `SHP-${year}-`
  const last = await db.shipment.findFirst({
    where: { shipmentNumber: { startsWith: prefix } },
    select: { shipmentNumber: true },
    orderBy: { shipmentNumber: 'desc' },
  })
  const lastSerial = last ? Number(last.shipmentNumber.slice(prefix.length)) : 0
  return `${prefix}${String(lastSerial + 1).padStart(5, '0')}`
}

export interface CreateShipmentResult {
  shipmentId: string | null
  /** Expected failures travel as data — Server Actions redact thrown errors. */
  error: string | null
}

export async function createShipment(draft: {
  clientId: string
  declarationOfficeId: string
  manifestId: string
  blNumber: string
  containerNumber: string
  goodsType: string
  packageType: string
  packageCount: string
  transportMode: string
  description: string
  grossWeightKg: string
  freightCharge: string
  insuranceCharge: string
  otherCharges: string
}): Promise<CreateShipmentResult> {
  const { claims, db, audit } = await actionContext('shipments:write')

  const money = (v: string) => {
    const n = Number(v)
    return v.trim() === '' || !Number.isFinite(n) ? undefined : n.toFixed(2)
  }

  let parsed
  try {
    parsed = shipmentCreateSchema.omit({ shipmentNumber: true }).parse({
      clientId: draft.clientId,
      declarationOfficeId: draft.declarationOfficeId,
      manifestId: draft.manifestId || undefined,
      blNumber: draft.blNumber.trim() || undefined,
      containerNumber: draft.containerNumber.trim() || undefined,
      goodsType: draft.goodsType,
      packageType: draft.packageType,
      packageCount: draft.packageCount || '1',
      transportMode: draft.transportMode,
      description: draft.description.trim() || undefined,
      grossWeightKg: draft.grossWeightKg.trim() || undefined,
      freightCharge: money(draft.freightCharge),
      insuranceCharge: money(draft.insuranceCharge),
      otherCharges: money(draft.otherCharges),
    })
  } catch {
    return { shipmentId: null, error: 'Check the form: client and declaration office are required.' }
  }

  // The org-scoped unique on shipmentNumber closes the small race between
  // reading the last number and inserting: on collision, re-read and retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const shipmentNumber = await nextShipmentNumber(db)
    try {
      const shipment = await shipmentsService.create(db, audit, {
        ...parsed,
        shipmentNumber,
        createdById: claims.sub,
        grossWeightKg: parsed.grossWeightKg === undefined ? undefined : String(parsed.grossWeightKg),
      })
      return { shipmentId: shipment.id, error: null }
    } catch (error) {
      const unique = (error as { code?: string }).code === 'P2002'
      if (unique && attempt < 2) continue
      if (error instanceof AppError) return { shipmentId: null, error: error.message }
      throw error
    }
  }
  return { shipmentId: null, error: 'Could not allocate a shipment number — try again.' }
}

// --- submit ------------------------------------------------------------------

export interface SubmitShipmentResult {
  outcome: 'ACCEPTED' | 'REJECTED' | null
  message: string | null
  entryNumber: string | null
  beaipReference: string | null
  /** Expected failures (not DRAFT, stale calculation, RBAC) travel as data. */
  error: string | null
}

export async function submitShipment(shipmentId: string): Promise<SubmitShipmentResult> {
  let context
  try {
    context = await actionContext('shipments:submit')
  } catch {
    return {
      outcome: null,
      message: null,
      entryNumber: null,
      beaipReference: null,
      error: 'Submitting requires the BROKER role.',
    }
  }
  const { db, audit } = context

  try {
    // C13 (home consumption) is what the overwhelming majority of declarations
    // are; a declaration-type picker is deliberately deferred.
    const result = await declarationsService.submit(db, audit, shipmentId, 'C13')
    return {
      outcome: result.entry.status === 'REJECTED' ? 'REJECTED' : 'ACCEPTED',
      message: result.message,
      entryNumber: result.entry.entryNumber,
      beaipReference: result.entry.beaipReference,
      error: null,
    }
  } catch (error) {
    if (error instanceof AppError) {
      return { outcome: null, message: null, entryNumber: null, beaipReference: null, error: error.message }
    }
    throw error
  }
}
