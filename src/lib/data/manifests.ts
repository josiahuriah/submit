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
import { manifestCreateSchema, manifestUpdateSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'

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
