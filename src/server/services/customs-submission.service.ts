/** Persist an explicit broker attempt before sending immutable XML to QA. */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { TenantClient } from '@/lib/db/tenant-client'
import { env } from '@/lib/env'
import { BusinessRuleError, ConflictError, NotFoundError } from '@/lib/errors'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { buildDeclarationSoapEnvelope } from '@/lib/beaip/transport/soap-envelope'
import {
  BeaipTransportError,
  postDeclarationSoap,
} from '@/lib/beaip/transport/http-gateway'
import { parseBeaipResponse } from '@/lib/beaip/transport/response-parser'

export const customsSubmissionService = {
  async submit(
    db: TenantClient,
    audit: AuditContext,
    customsEntryId: string,
    input: { confirmResubmission: boolean; resubmissionReason?: string },
  ) {
    const configuration = env()
    if (configuration.BEAIP_TRANSPORT_MODE !== 'live') {
      throw new BusinessRuleError('BEAIP transport is disabled. Add the QA settings, then explicitly enable live transport.')
    }
    const entry = await db.customsEntry.findUnique({
      where: { id: customsEntryId },
      select: {
        id: true, shipmentId: true, submissionBatchId: true, status: true,
        requestPayload: true, declarationHash: true, functionalReferenceId: true,
        generatedAt: true,
        shipment: { select: { status: true, calculatedAt: true, updatedAt: true } },
        attempts: {
          select: { attemptNumber: true, outcome: true, startedAt: true },
          orderBy: { attemptNumber: 'desc' },
        },
      },
    })
    if (!entry || !entry.requestPayload) throw new NotFoundError('Customs declaration artifact')
    if (!['DRAFT', 'SUBMITTED'].includes(entry.shipment.status)) {
      throw new BusinessRuleError('Only draft or previously submitted shipments can be sent to Customs')
    }
    if (entry.shipment.status === 'DRAFT' && (
      !entry.generatedAt || !entry.shipment.calculatedAt
      || entry.shipment.calculatedAt > entry.generatedAt
      || entry.shipment.updatedAt > entry.generatedAt
    )) {
      throw new BusinessRuleError('Shipment changed after this artifact was generated; recalculate and generate new review XML before submitting')
    }
    if (entry.attempts.some((attempt) => attempt.outcome === 'PENDING')) {
      throw new BusinessRuleError('A submission attempt is still pending; reconcile it before sending again')
    }
    // A sibling entry in the same split batch is an expected first submission,
    // not a duplicate. Warn only for this exact entry or an older batch.
    const repeatedEntryFilter = entry.submissionBatchId
      ? {
          shipmentId: entry.shipmentId,
          OR: [
            { id: entry.id },
            { submissionBatchId: null },
            { submissionBatchId: { not: entry.submissionBatchId } },
          ],
        }
      : { shipmentId: entry.shipmentId }
    const [previousAttemptCount, latestPreviousAttempt] = await Promise.all([
      db.customsSubmissionAttempt.count({
        where: { customsEntry: repeatedEntryFilter },
      }),
      db.customsSubmissionAttempt.findFirst({
        where: { customsEntry: repeatedEntryFilter },
        select: { attemptNumber: true, outcome: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
      }),
    ])
    if (previousAttemptCount > 0 && !input.confirmResubmission) {
      throw new ConflictError('This shipment has already been submitted. Explicit confirmation is required to submit another declaration attempt.', {
        attempts: previousAttemptCount,
        latest: latestPreviousAttempt,
      })
    }

    const exactHash = createHash('sha256').update(entry.requestPayload, 'utf8').digest('hex')
    if (exactHash !== entry.declarationHash) {
      throw new BusinessRuleError('Stored declaration hash does not match its immutable XML artifact')
    }
    const messageId = randomUUID()
    const attemptNumber = (entry.attempts[0]?.attemptNumber ?? 0) + 1
    const soap = buildDeclarationSoapEnvelope({
      username: configuration.BEAIP_USERNAME,
      password: configuration.BEAIP_PASSWORD,
      declarationXml: entry.requestPayload,
    })
    const attempt = await db.customsSubmissionAttempt.create({
      data: {
        customsEntryId: entry.id,
        attemptNumber,
        messageId,
        declarationHash: exactHash,
        redactedSoapEnvelope: soap.redactedEnvelope,
        resubmissionReason: input.resubmissionReason,
      } as never,
      select: { id: true },
    })

    try {
      const response = await postDeclarationSoap(soap.envelope, configuration)
      let parsed
      try {
        parsed = parseBeaipResponse(response.body)
      } catch {
        parsed = { kind: 'UNRECOGNIZED_RESPONSE' as const }
      }
      if (parsed.kind === 'ACKNOWLEDGED' && (response.httpStatus < 200 || response.httpStatus >= 300)) {
        parsed = { kind: 'UNRECOGNIZED_RESPONSE' as const }
      }
      const outcome = parsed.kind
      await db.customsSubmissionAttempt.update({
        where: { id: attempt.id },
        data: {
          outcome,
          responsePayload: response.body,
          httpStatus: response.httpStatus,
          soapFaultCode: parsed.kind === 'SOAP_FAULT' ? parsed.faultCode : undefined,
          soapFaultReason: parsed.kind === 'SOAP_FAULT' ? parsed.faultReason : undefined,
          beaipReference: parsed.kind === 'ACKNOWLEDGED' ? parsed.beaipReference : undefined,
          businessErrors: parsed.kind === 'BUSINESS_REJECTED' ? JSON.parse(JSON.stringify(parsed.errors)) : undefined,
          completedAt: new Date(),
        } as never,
      })
      await db.customsEntry.update({
        where: { id: entry.id },
        data: {
          responsePayload: response.body,
          ...(parsed.kind === 'ACKNOWLEDGED' ? {
            status: 'SUBMITTED', submittedAt: new Date(), beaipReference: parsed.beaipReference,
          } : {}),
          ...(parsed.kind === 'BUSINESS_REJECTED' ? {
            status: 'REJECTED', rejectionReason: 'Click2Clear business validation rejected the declaration',
          } : {}),
        } as never,
      })
      if (parsed.kind === 'ACKNOWLEDGED') {
        const unresolvedInBatch = entry.submissionBatchId
          ? await db.customsEntry.count({
              where: { submissionBatchId: entry.submissionBatchId, status: { not: 'SUBMITTED' } },
            })
          : 0
        if (unresolvedInBatch === 0) {
          await db.shipment.update({
            where: { id: entry.shipmentId },
            data: { status: 'SUBMITTED', submittedAt: new Date() },
          })
        }
      }
      await writeAudit(db, audit, {
        action: 'SUBMIT', entityType: 'CustomsSubmissionAttempt', entityId: attempt.id,
        changes: { after: { customsEntryId: entry.id, attemptNumber, messageId, outcome, httpStatus: response.httpStatus } },
      })
      return {
        attemptId: attempt.id,
        attemptNumber,
        messageId,
        outcome,
        httpStatus: response.httpStatus,
        beaipReference: parsed.kind === 'ACKNOWLEDGED' ? parsed.beaipReference : null,
        fault: parsed.kind === 'SOAP_FAULT' ? { code: parsed.faultCode, reason: parsed.faultReason } : null,
        responsePayload: response.body,
      }
    } catch (error) {
      if (!(error instanceof BeaipTransportError)) throw error
      await db.customsSubmissionAttempt.update({
        where: { id: attempt.id },
        data: { outcome: error.outcome, completedAt: new Date() },
      })
      await writeAudit(db, audit, {
        action: 'SUBMIT', entityType: 'CustomsSubmissionAttempt', entityId: attempt.id,
        changes: { after: { customsEntryId: entry.id, attemptNumber, messageId, outcome: error.outcome } },
      })
      return {
        attemptId: attempt.id, attemptNumber, messageId, outcome: error.outcome,
        httpStatus: null, beaipReference: null, fault: null, responsePayload: null,
      }
    }
  },
}
