/**
 * DATA-ACCESS SEAM — MANIFESTS
 * -----------------------------------------------------------------------------
 * Same pattern as line-items.ts: the only place the Manifests UI meets the
 * backend. Reads plus one Server Action (createManifest).
 *
 * Two scoping rules, deliberately:
 *   - Manifests are TENANT data, read through a session-scoped TenantClient.
 *   - Voyages / vessels / shipping agents are GLOBAL transport references
 *     shared by every brokerage, accessed through transportReferencesService
 *     and still only reachable behind an authenticated page.
 */
'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { catalogService } from '@/server/services/catalog.service'
import { transportReferencesService } from '@/server/services/transport-references.service'
import {
  journeyCreateSchema,
  manifestCreateSchema,
  manifestUpdateSchema,
  shippingAgentCreateSchema,
  vesselCreateSchema,
  voyageCreateSchema,
} from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'
import type { AuditContext } from '@/lib/audit'
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

export interface CarrierOption {
  id: string
  label: string
  mode: 'SEA' | 'AIR'
}

export interface PortOption {
  id: string
  label: string
  unLocode: string
}

export interface ManifestReferenceOptions {
  carriers: CarrierOption[]
  ports: PortOption[]
  vessels: VesselOption[]
  journeys: JourneyOption[]
}

function isoDay(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

async function manifestWriteContext() {
  const claims = await requireSession()
  requirePermission(claims.role, 'shipments:write')
  const headerList = await headers()
  return {
    db: createTenantClient(claims.orgId),
    audit: {
      userId: claims.sub,
      ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerList.get('user-agent') ?? undefined,
    } satisfies AuditContext,
  }
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
  const voyages = await transportReferencesService.listVoyages()
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
  return transportReferencesService.listShippingAgents()
}

export async function listManifestReferenceOptions(): Promise<ManifestReferenceOptions> {
  await requireSession()
  const { carriers, ports, vessels, journeys } = await transportReferencesService.listDirectory()
  return {
    carriers: carriers.map((carrier) => ({
      id: carrier.id,
      label: `${carrier.name} · ${carrier.code}`,
      mode: carrier.mode as 'SEA' | 'AIR',
    })),
    ports: ports.map((port) => ({
      id: port.id,
      label: `${port.unLocode} · ${port.name} (${port.country})`,
      unLocode: port.unLocode,
    })),
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
  const { db, audit } = await manifestWriteContext()
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
    const agent = await transportReferencesService.createShippingAgent(db, audit, input)
    revalidatePath('/manifests')
    return { agent, error: null }
  } catch (error) {
    if (error instanceof AppError) return { agent: null, error: error.message }
    return { agent: null, error: 'Could not create the shipping agent.' }
  }
}

export async function createVessel(draft: {
  carrierId: string
  name: string
  mode: 'SEA' | 'AIR'
  imoNumber: string
}): Promise<{ vessel: VesselOption | null; error: string | null }> {
  const { db, audit } = await manifestWriteContext()
  let input
  try {
    input = vesselCreateSchema.parse({
      carrierId: draft.carrierId,
      name: draft.name.trim(),
      mode: draft.mode,
      imoNumber: draft.mode === 'SEA' ? draft.imoNumber.trim() || undefined : undefined,
    })
  } catch {
    return { vessel: null, error: 'Select a matching carrier and enter a vessel or aircraft name.' }
  }

  try {
    const vessel = await transportReferencesService.createVessel(db, audit, input)
    const option = {
      id: vessel.id,
      label: `${vessel.name} · ${vessel.carrier.name} · ${vessel.mode.toLowerCase()}`,
    }
    revalidatePath('/manifests')
    return { vessel: option, error: null }
  } catch (error) {
    if (error instanceof AppError) return { vessel: null, error: error.message }
    return { vessel: null, error: 'Could not create the vessel or aircraft.' }
  }
}

export async function createRoute(draft: {
  originPortId: string
  destinationPortId: string
}): Promise<{ route: JourneyOption | null; error: string | null }> {
  const { db, audit } = await manifestWriteContext()
  let input
  try {
    input = journeyCreateSchema.parse(draft)
  } catch {
    return { route: null, error: 'Select two different ports.' }
  }

  try {
    const route = await transportReferencesService.createJourney(db, audit, input)
    const option = {
      id: route.id,
      label: `${route.originPort.unLocode} → ${route.destinationPort.unLocode}`,
    }
    revalidatePath('/manifests')
    return { route: option, error: null }
  } catch (error) {
    if (error instanceof AppError) return { route: null, error: error.message }
    return { route: null, error: 'Could not create the route.' }
  }
}

export async function createVoyage(draft: {
  vesselId: string
  journeyId: string
  voyageNumber: string
  departureDate: string
  arrivalDate: string
}): Promise<{ voyage: VoyageOption | null; error: string | null }> {
  const { db, audit } = await manifestWriteContext()
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
    const voyage = await transportReferencesService.createVoyage(db, audit, input)
    const route = voyage.journey
      ? ` · ${voyage.journey.originPort.unLocode} → ${voyage.journey.destinationPort.unLocode}`
      : ''
    const option = {
      id: voyage.id,
      label: `${voyage.vessel.name} · ${voyage.voyageNumber}${route} · arr ${isoDay(voyage.arrivalDate)}`,
    }
    revalidatePath('/manifests')
    return { voyage: option, error: null }
  } catch (error) {
    if (error instanceof AppError) return { voyage: null, error: error.message }
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
  const { db, audit } = await manifestWriteContext()

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
  const { db, audit } = await manifestWriteContext()

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
