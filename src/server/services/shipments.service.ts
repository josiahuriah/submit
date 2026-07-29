/**
 * Shipments service — business rules live here, not in routes or the repo.
 *
 * Rules enforced:
 *   - Status machine: DRAFT → SUBMITTED → CLEARED; CANCELLED from
 *     DRAFT/SUBMITTED. Submission itself happens via declarations.service.
 *   - Only DRAFT shipments can be edited or deleted (submitted declarations
 *     are legal documents — you amend via customs, not by editing history).
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { shipmentsRepository, type ShipmentListFilters } from '@/server/repositories/shipments.repository'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import type { ShipmentStatus } from '@/generated/prisma/enums'

const EDITABLE_STATUSES: ShipmentStatus[] = ['DRAFT']

const ALLOWED_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['CLEARED', 'CANCELLED'],
  CLEARED: [],
  CANCELLED: [],
}

export const shipmentsService = {
  list(db: TenantClient, filters: ShipmentListFilters) {
    return shipmentsRepository.list(db, filters)
  },

  async get(db: TenantClient, shipmentId: string) {
    const shipment = await shipmentsRepository.byId(db, shipmentId)
    if (!shipment) throw new NotFoundError('Shipment')
    return shipment
  },

  async create(
    db: TenantClient,
    audit: AuditContext,
    input: Parameters<typeof shipmentsRepository.create>[1],
  ) {
    const shipment = await shipmentsRepository.create(db, input)
    await writeAudit(db, audit, {
      action: 'CREATE',
      entityType: 'Shipment',
      entityId: shipment.id,
      changes: { after: { shipmentNumber: shipment.shipmentNumber } },
    })
    return shipment
  },

  async update(
    db: TenantClient,
    audit: AuditContext,
    shipmentId: string,
    input: Record<string, unknown>,
  ) {
    const existing = await shipmentsRepository.byId(db, shipmentId)
    if (!existing) throw new NotFoundError('Shipment')
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BusinessRuleError(
        `Shipment ${existing.shipmentNumber} is ${existing.status} and can no longer be edited`,
      )
    }
    const updated = await shipmentsRepository.update(db, shipmentId, input)
    await writeAudit(db, audit, {
      action: 'UPDATE',
      entityType: 'Shipment',
      entityId: shipmentId,
      changes: { before: diffable(existing), after: diffable(updated) },
    })
    return updated
  },

  async transitionStatus(
    db: TenantClient,
    audit: AuditContext,
    shipmentId: string,
    next: ShipmentStatus,
  ) {
    const existing = await shipmentsRepository.byId(db, shipmentId)
    if (!existing) throw new NotFoundError('Shipment')
    if (!ALLOWED_TRANSITIONS[existing.status].includes(next)) {
      throw new BusinessRuleError(`Cannot move a ${existing.status} shipment to ${next}`)
    }
    const timestamps: Record<string, Date> = {}
    if (next === 'SUBMITTED') timestamps.submittedAt = new Date()
    if (next === 'CLEARED') timestamps.clearedAt = new Date()

    const updated = await shipmentsRepository.update(db, shipmentId, {
      status: next,
      ...timestamps,
    })
    await writeAudit(db, audit, {
      action: 'STATUS_CHANGE',
      entityType: 'Shipment',
      entityId: shipmentId,
      changes: { before: { status: existing.status }, after: { status: next } },
    })
    return updated
  },

  async remove(db: TenantClient, audit: AuditContext, shipmentId: string) {
    const existing = await shipmentsRepository.byId(db, shipmentId)
    if (!existing) throw new NotFoundError('Shipment')
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      throw new BusinessRuleError('Only DRAFT shipments can be deleted')
    }
    await shipmentsRepository.delete(db, shipmentId)
    await writeAudit(db, audit, {
      action: 'DELETE',
      entityType: 'Shipment',
      entityId: shipmentId,
      changes: { before: { shipmentNumber: existing.shipmentNumber } },
    })
  },
}

/** Trim the detail payload down to fields worth diffing in audit logs. */
function diffable(s: Record<string, unknown>) {
  const pick = [
    'shipmentNumber',
    'status',
    'blNumber',
    'containerNumber',
    'description',
    'packageCount',
    'freightCharge',
    'insuranceCharge',
    'otherCharges',
  ]
  return Object.fromEntries(pick.filter((k) => k in s).map((k) => [k, String(s[k] ?? '')]))
}
