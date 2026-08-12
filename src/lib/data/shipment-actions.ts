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
import { catalogService } from '@/server/services/catalog.service'
import { shipmentCreateSchema, shipmentUpdateSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'
import { revalidatePath } from 'next/cache'
import { kilogramsToPounds, poundsToKilograms } from '@/lib/units/weight'
import { ORIGINAL_DECLARATION_FUNCTION_CODE } from '@/lib/beaip/constants'

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

export interface ShipmentEditDraft {
  shipmentNumber: string
  clientId: string
  declarationOfficeId: string
  manifestId: string
  blNumber: string
  containerNumber: string
  containerSealNumber: string
  containerFullnessCode: string
  declarationDate: string
  declarationFunctionCode: string
  regimeCode: string
  goodsLocationCode: string
  warehouseCode: string
  transportNationalityCode: string
  goodsType: string
  packageType: string
  packageCount: string
  transportMode: string
  description: string
  grossWeightLb: string
  netWeightLb: string
  freightCharge: string
  insuranceCharge: string
  otherCharges: string
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
    clients: clients.items.filter((c) => c.isActive).map((c) => ({ id: c.id, label: c.name })),
    offices: offices.map((o) => ({ id: o.id, label: `${o.code} — ${o.name}` })),
    manifests: manifests.items.map((m) => ({
      id: m.id,
      label: `${m.manifestNumber} · ${m.voyage.vessel.name} ${m.voyage.voyageNumber}`,
    })),
  }
}

export async function getShipmentEditData(shipmentId: string): Promise<{
  draft: ShipmentEditDraft
  options: NewShipmentOptions
}> {
  const claims = await requireSession()
  const db = createTenantClient(claims.orgId)
  const [shipment, options] = await Promise.all([
    shipmentsService.get(db, shipmentId),
    listNewShipmentOptions(),
  ])

  return {
    draft: {
      shipmentNumber: shipment.shipmentNumber,
      clientId: shipment.client.id,
      declarationOfficeId: shipment.declarationOffice.id,
      manifestId: shipment.manifest?.id ?? '',
      blNumber: shipment.blNumber ?? '',
      containerNumber: shipment.containerNumber ?? '',
      containerSealNumber: shipment.containerSealNumber ?? '',
      containerFullnessCode: shipment.containerFullnessCode ?? '',
      declarationDate: shipment.declarationDate.toISOString().slice(0, 10),
      declarationFunctionCode: shipment.declarationFunctionCode,
      regimeCode: shipment.regimeCode,
      goodsLocationCode: shipment.goodsLocationCode ?? '',
      warehouseCode: shipment.warehouseCode ?? '',
      transportNationalityCode: shipment.transportNationalityCode ?? '',
      goodsType: shipment.goodsType,
      packageType: shipment.packageType,
      packageCount: String(shipment.packageCount),
      transportMode: shipment.transportMode,
      description: shipment.description ?? '',
      grossWeightLb: kilogramsToPounds(shipment.grossWeightKg === null ? null : String(shipment.grossWeightKg)),
      netWeightLb: kilogramsToPounds(shipment.netWeightKg === null ? null : String(shipment.netWeightKg)),
      freightCharge: String(shipment.freightCharge),
      insuranceCharge: String(shipment.insuranceCharge),
      otherCharges: String(shipment.otherCharges),
    },
    options: {
      ...options,
      clients: options.clients.some((client) => client.id === shipment.client.id)
        ? options.clients
        : [{ id: shipment.client.id, label: shipment.client.name }, ...options.clients],
    },
  }
}

export async function updateShipment(
  shipmentId: string,
  draft: ShipmentEditDraft,
): Promise<{ ok: boolean; error: string | null }> {
  const { db, audit } = await actionContext('shipments:write')
  let input
  try {
    input = shipmentUpdateSchema.parse({
      shipmentNumber: draft.shipmentNumber.trim(),
      clientId: draft.clientId,
      declarationOfficeId: draft.declarationOfficeId,
      manifestId: draft.manifestId || null,
      blNumber: draft.blNumber.trim(),
      containerNumber: draft.containerNumber.trim(),
      containerSealNumber: draft.containerSealNumber.trim(),
      containerFullnessCode: draft.containerFullnessCode.trim(),
      declarationDate: draft.declarationDate,
      declarationFunctionCode: ORIGINAL_DECLARATION_FUNCTION_CODE,
      regimeCode: draft.regimeCode.trim(),
      goodsLocationCode: draft.goodsLocationCode.trim(),
      warehouseCode: draft.warehouseCode.trim(),
      transportNationalityCode: draft.transportNationalityCode.trim().toUpperCase() || undefined,
      goodsType: draft.goodsType,
      packageType: draft.packageType,
      packageCount: draft.packageCount,
      transportMode: draft.transportMode,
      description: draft.description.trim(),
      grossWeightKg: poundsToKilograms(draft.grossWeightLb) || null,
      netWeightKg: poundsToKilograms(draft.netWeightLb) || null,
      freightCharge: draft.freightCharge.trim() || '0',
      insuranceCharge: draft.insuranceCharge.trim() || '0',
      otherCharges: draft.otherCharges.trim() || '0',
    })
  } catch {
    return { ok: false, error: 'Check required fields and numeric values before saving.' }
  }

  try {
    await shipmentsService.update(db, audit, shipmentId, input)
    revalidatePath('/shipments')
    revalidatePath(`/shipments/${shipmentId}/entry`)
    revalidatePath('/home')
    return { ok: true, error: null }
  } catch (error) {
    if (error instanceof AppError) return { ok: false, error: error.message }
    return { ok: false, error: 'Could not update the shipment.' }
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
  containerSealNumber: string
  regimeCode: string
  goodsType: string
  packageType: string
  packageCount: string
  transportMode: string
  description: string
  grossWeightLb: string
  netWeightLb: string
  freightCharge: string
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
      containerSealNumber: draft.containerSealNumber.trim() || undefined,
      regimeCode: draft.regimeCode.trim() || '4',
      declarationFunctionCode: ORIGINAL_DECLARATION_FUNCTION_CODE,
      goodsType: draft.goodsType,
      packageType: draft.packageType,
      packageCount: draft.packageCount || '1',
      transportMode: draft.transportMode,
      description: draft.description.trim() || undefined,
      grossWeightKg: poundsToKilograms(draft.grossWeightLb) || undefined,
      netWeightKg: poundsToKilograms(draft.netWeightLb) || undefined,
      freightCharge: money(draft.freightCharge),
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
