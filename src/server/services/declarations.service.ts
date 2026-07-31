/**
 * Declarations service — orchestrates the submit workflow:
 *
 *   validate → map shipment → submit to BEAIP → record CustomsEntry
 *   (with the exact request/response payloads) → advance shipment status.
 *
 * Preconditions enforced:
 *   - shipment is DRAFT
 *   - a calculation has been run since the last edit (calculatedAt ≥ updatedAt
 *     tolerance) — you cannot submit numbers you haven't computed
 *   - submitting user holds shipments:submit (checked at the route)
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { getBeaipClient } from '@/lib/beaip'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import { loadDeclarationSource, toBeaipDeclaration } from './declaration-mapper'
import type { DeclarationType } from '@/generated/prisma/enums'

export const declarationsService = {
  async submit(
    db: TenantClient,
    audit: AuditContext,
    shipmentId: string,
    declarationType: DeclarationType,
  ) {
    const shipment = await loadDeclarationSource(db, shipmentId)

    if (!shipment) throw new NotFoundError('Shipment')
    if (shipment.status !== 'DRAFT') {
      throw new BusinessRuleError(`Shipment is ${shipment.status}; only DRAFT shipments can be submitted`)
    }
    if (!shipment.calculatedAt) {
      throw new BusinessRuleError('Run the duty calculation before submitting this declaration')
    }
    if (shipment.calculatedAt < shipment.updatedAt) {
      // Small tolerance: the calculation itself bumps updatedAt.
      const driftMs = shipment.updatedAt.getTime() - shipment.calculatedAt.getTime()
      if (driftMs > 5_000) {
        throw new BusinessRuleError(
          'Shipment changed after the last calculation — recalculate before submitting',
        )
      }
    }

    if (shipment.invoices.every((inv) => inv.lineItems.length === 0)) {
      throw new BusinessRuleError('Shipment has no line items')
    }

    // Map to the BEAIP contract (shared with the WCO XML generator script).
    const declaration = toBeaipDeclaration(shipment, declarationType)

    // Submit through whichever client the environment provides.
    const beaip = getBeaipClient()
    const result = await beaip.submitDeclaration(declaration)

    // Record the round trip regardless of outcome — rejections are part of
    // the legal audit trail too.
    const entry = await db.customsEntry.create({
      data: {
        shipmentId: shipment.id,
        declarationType,
        status: result.success ? 'SUBMITTED' : 'REJECTED',
        beaipReference: result.beaipReference,
        entryNumber: result.entryNumber,
        submittedAt: result.success ? new Date() : null,
        rejectionReason: result.success ? null : result.message,
        requestPayload: JSON.parse(JSON.stringify(result.requestPayload)),
        responsePayload: JSON.parse(JSON.stringify(result.responsePayload)),
        totalPayable: String(shipment.totalPayable),
      } as never,
      select: {
        id: true,
        status: true,
        beaipReference: true,
        entryNumber: true,
        declarationType: true,
        submittedAt: true,
        rejectionReason: true,
        totalPayable: true,
      },
    })

    if (result.success) {
      await db.shipment.update({
        where: { id: shipment.id },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      })
    }

    await writeAudit(db, audit, {
      action: 'SUBMIT',
      entityType: 'CustomsEntry',
      entityId: entry.id,
      changes: {
        after: {
          shipmentNumber: shipment.shipmentNumber,
          outcome: entry.status,
          beaipReference: result.beaipReference,
          mode: beaip.mode,
        },
      },
    })

    return {
      entry,
      beaipMode: beaip.mode,
      message: result.message,
    }
  },

  /** Refresh a customs entry's status from BEAIP. */
  async refreshStatus(db: TenantClient, audit: AuditContext, entryId: string) {
    const entry = await db.customsEntry.findUnique({
      where: { id: entryId },
      select: { id: true, beaipReference: true, status: true },
    })
    if (!entry) throw new NotFoundError('Customs entry')
    if (!entry.beaipReference) {
      throw new BusinessRuleError('Entry has no BEAIP reference to query')
    }

    const beaip = getBeaipClient()
    const remote = await beaip.getDeclarationStatus(entry.beaipReference)

    const updated = await db.customsEntry.update({
      where: { id: entryId },
      data: {
        responsePayload: JSON.parse(JSON.stringify(remote.responsePayload)),
      },
      select: { id: true, status: true, beaipReference: true },
    })

    await writeAudit(db, audit, {
      action: 'UPDATE',
      entityType: 'CustomsEntry',
      entityId: entryId,
      changes: { after: { remoteStatus: remote.status } },
    })

    return { entry: updated, remoteStatus: remote.status, message: remote.message }
  },
}
