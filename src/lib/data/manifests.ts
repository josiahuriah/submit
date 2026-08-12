/**
 * DATA-ACCESS SEAM — MANIFESTS
 * -----------------------------------------------------------------------------
 * Same pattern as line-items.ts: the only place the Manifests UI meets the
 * backend. Reads plus one Server Action (createManifest).
 *
 * Two scoping rules, deliberately:
 *   - Manifests are TENANT data, read through a session-scoped TenantClient.
 *   - Voyages / vessels / shipping agents are GLOBAL transport fixtures shared
 *     by every brokerage, read via basePrisma (like HS codes) — still only
 *     reachable behind an authenticated page.
 */
'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { basePrisma } from '@/lib/db/prisma'
import { catalogService } from '@/server/services/catalog.service'
import { manifestCreateSchema, manifestUpdateSchema, shippingAgentCreateSchema, voyageCreateSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'
import { writeAudit } from '@/lib/audit'
import { revalidatePath } from 'next/cache'

export interface ManifestListItem {
  id: string
  manifestNumber: string
  status: string
  voyageId: string
  vesselName: string
  voyageNumber: string
  shippingAgentId: string | null
  shippingAgentName: string | null
  arrival: string
  registeredAt: string
  notes: string | null
}

export interface VoyageOption {
  id: string
  label: string // "Tropic Freedom · TF-2607 · USMIA → BSNAS · arr 2026-07-03"
}

export interface AgentOption {
  id: string
  name: string
}

export interface VesselOption {
  id: string
  label: string
}

export interface JourneyOption {
  id: string
  label: string
}

export interface ManifestReferenceOptions {
  vessels: VesselOption[]
  journeys: JourneyOption[]
}

function isoDay(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

export async function listManifests(): Promise<ManifestListItem[]> {
  const claims = await requireSession()
  const db = createTenantClient(claims.orgId)
  const page = await catalogService.listManifests(db, {})
  return page.items.map((m) => ({
    id: m.id,
    manifestNumber: m.manifestNumber,
    status: m.status,
    voyageId: m.voyage.id,
    vesselName: m.voyage.vessel.name,
    voyageNumber: m.voyage.voyageNumber,
    shippingAgentId: m.shippingAgent?.id ?? null,
    shippingAgentName: m.shippingAgent?.name ?? null,
    arrival: isoDay(m.voyage.arrivalDate),
    registeredAt: isoDay(m.registeredAt),
    notes: m.notes,
  }))
}

/** Global voyage fixtures for the create form's picker. */
export async function listVoyageOptions(): Promise<VoyageOption[]> {
  await requireSession()
  const voyages = await basePrisma.voyage.findMany({
    select: {
      id: true,
      voyageNumber: true,
      arrivalDate: true,
      vessel: { select: { name: true } },
      journey: {
        select: {
          originPort: { select: { unLocode: true } },
          destinationPort: { select: { unLocode: true } },
        },
      },
    },
    orderBy: { arrivalDate: 'desc' },
    take: 50,
  })
  return voyages.map((v) => {
    const route = v.journey
      ? ` · ${v.journey.originPort.unLocode} → ${v.journey.destinationPort.unLocode}`
      : ''
    return {
      id: v.id,
      label: `${v.vessel.name} · ${v.voyageNumber}${route} · arr ${isoDay(v.arrivalDate)}`,
    }
  })
}

export async function listAgentOptions(): Promise<AgentOption[]> {
  await requireSession()
  const agents = await basePrisma.shippingAgent.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return agents
}

export async function listManifestReferenceOptions(): Promise<ManifestReferenceOptions> {
  await requireSession()
  const [vessels, journeys] = await Promise.all([
    basePrisma.vessel.findMany({
      where: { isActive: true, mode: { in: ['SEA', 'AIR'] } },
      select: { id: true, name: true, mode: true, carrier: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    basePrisma.journey.findMany({
      select: {
        id: true,
        originPort: { select: { unLocode: true, name: true } },
        destinationPort: { select: { unLocode: true, name: true } },
      },
      orderBy: { originPort: { unLocode: 'asc' } },
    }),
  ])
  return {
    vessels: vessels.map((vessel) => ({
      id: vessel.id,
      label: `${vessel.name} · ${vessel.carrier.name} · ${vessel.mode.toLowerCase()}`,
    })),
    journeys: journeys.map((journey) => ({
      id: journey.id,
      label: `${journey.originPort.unLocode} → ${journey.destinationPort.unLocode}`,
    })),
  }
}

export async function createShippingAgent(draft: {
  name: string
  code: string
  email: string
  phone: string
}): Promise<{ agent: AgentOption | null; error: string | null }> {
  const claims = await requireSession()
  requirePermission(claims.role, 'shipments:write')
  const headerList = await headers()
  const db = createTenantClient(claims.orgId)
  let input
  try {
    input = shippingAgentCreateSchema.parse({
      name: draft.name.trim(),
      code: draft.code.trim() || undefined,
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
    })
  } catch {
    return { agent: null, error: 'Enter an agent name and check the optional code and contact details.' }
  }

  try {
    const agent = await basePrisma.shippingAgent.create({
      data: input,
      select: { id: true, name: true },
    })
    await writeAudit(db, {
      userId: claims.sub,
      ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerList.get('user-agent') ?? undefined,
    }, { action: 'CREATE', entityType: 'ShippingAgentReference', entityId: agent.id, changes: { after: input } })
    revalidatePath('/manifests')
    return { agent, error: null }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return { agent: null, error: `Shipping agent code "${input.code}" is already in use.` }
    }
    return { agent: null, error: 'Could not create the shipping agent.' }
  }
}

export async function createVoyage(draft: {
  vesselId: string
  journeyId: string
  voyageNumber: string
  departureDate: string
  arrivalDate: string
}): Promise<{ voyage: VoyageOption | null; error: string | null }> {
  const claims = await requireSession()
  requirePermission(claims.role, 'shipments:write')
  const headerList = await headers()
  const db = createTenantClient(claims.orgId)
  let input
  try {
    input = voyageCreateSchema.parse({
      vesselId: draft.vesselId,
      journeyId: draft.journeyId || undefined,
      voyageNumber: draft.voyageNumber.trim(),
      departureDate: draft.departureDate || undefined,
      arrivalDate: draft.arrivalDate || undefined,
    })
  } catch {
    return { voyage: null, error: 'Select a vessel and enter a voyage number; check the dates.' }
  }

  try {
    const voyage = await basePrisma.voyage.create({
      data: input,
      select: {
        id: true,
        voyageNumber: true,
        arrivalDate: true,
        vessel: { select: { name: true } },
        journey: {
          select: {
            originPort: { select: { unLocode: true } },
            destinationPort: { select: { unLocode: true } },
          },
        },
      },
    })
    const route = voyage.journey
      ? ` · ${voyage.journey.originPort.unLocode} → ${voyage.journey.destinationPort.unLocode}`
      : ''
    const option = {
      id: voyage.id,
      label: `${voyage.vessel.name} · ${voyage.voyageNumber}${route} · arr ${isoDay(voyage.arrivalDate)}`,
    }
    await writeAudit(db, {
      userId: claims.sub,
      ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerList.get('user-agent') ?? undefined,
    }, { action: 'CREATE', entityType: 'VoyageReference', entityId: voyage.id, changes: { after: input } })
    revalidatePath('/manifests')
    return { voyage: option, error: null }
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return { voyage: null, error: `Voyage "${input.voyageNumber}" already exists for that vessel.` }
    }
    return { voyage: null, error: 'Could not create the voyage. Check that the selected vessel and journey still exist.' }
  }
}

export interface CreateManifestResult {
  manifest: ManifestListItem | null
  /** Expected failures travel as data — Server Actions redact thrown errors. */
  error: string | null
}

export type UpdateManifestResult = CreateManifestResult

export async function createManifest(draft: {
  manifestNumber: string
  voyageId: string
  shippingAgentId: string
  notes: string
}): Promise<CreateManifestResult> {
  const claims = await requireSession()
  requirePermission(claims.role, 'shipments:write')
  const headerList = await headers()
  const db = createTenantClient(claims.orgId)
  const audit = {
    userId: claims.sub,
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerList.get('user-agent') ?? undefined,
  }

  let input
  try {
    input = manifestCreateSchema.parse({
      manifestNumber: draft.manifestNumber.trim(),
      voyageId: draft.voyageId,
      shippingAgentId: draft.shippingAgentId || undefined,
      notes: draft.notes.trim() || undefined,
    })
  } catch {
    return { manifest: null, error: 'Check the form: a manifest number and voyage are required.' }
  }

  try {
    const m = await catalogService.createManifest(db, audit, input)
    return {
      manifest: {
        id: m.id,
        manifestNumber: m.manifestNumber,
        status: m.status,
        voyageId: m.voyage.id,
        vesselName: m.voyage.vessel.name,
        voyageNumber: m.voyage.voyageNumber,
        shippingAgentId: m.shippingAgent?.id ?? null,
        shippingAgentName: m.shippingAgent?.name ?? null,
        arrival: isoDay(m.voyage.arrivalDate),
        registeredAt: isoDay(m.registeredAt),
        notes: m.notes,
      },
      error: null,
    }
  } catch (error) {
    if (error instanceof AppError) return { manifest: null, error: error.message }
    // The org-scoped unique on manifestNumber is the likely non-AppError cause.
    return { manifest: null, error: `A manifest numbered "${input.manifestNumber}" already exists.` }
  }
}

export async function updateManifest(
  manifestId: string,
  draft: {
    manifestNumber: string
    voyageId: string
    shippingAgentId: string
    registeredAt: string
    status: string
    notes: string
  },
): Promise<UpdateManifestResult> {
  const claims = await requireSession()
  requirePermission(claims.role, 'shipments:write')
  const headerList = await headers()
  const db = createTenantClient(claims.orgId)
  const audit = {
    userId: claims.sub,
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerList.get('user-agent') ?? undefined,
  }

  let input
  try {
    input = manifestUpdateSchema.parse({
      manifestNumber: draft.manifestNumber.trim(),
      voyageId: draft.voyageId,
      shippingAgentId: draft.shippingAgentId || null,
      registeredAt: draft.registeredAt || null,
      status: draft.status,
      notes: draft.notes.trim(),
    })
  } catch {
    return { manifest: null, error: 'Check the manifest number, voyage, status and registration date.' }
  }

  try {
    const m = await catalogService.updateManifest(db, audit, manifestId, input)
    return {
      manifest: {
        id: m.id,
        manifestNumber: m.manifestNumber,
        status: m.status,
        voyageId: m.voyage.id,
        vesselName: m.voyage.vessel.name,
        voyageNumber: m.voyage.voyageNumber,
        shippingAgentId: m.shippingAgent?.id ?? null,
        shippingAgentName: m.shippingAgent?.name ?? null,
        arrival: isoDay(m.voyage.arrivalDate),
        registeredAt: isoDay(m.registeredAt),
        notes: m.notes,
      },
      error: null,
    }
  } catch (error) {
    if (error instanceof AppError) return { manifest: null, error: error.message }
    return { manifest: null, error: `Could not update manifest "${input.manifestNumber ?? manifestId}".` }
  }
}
