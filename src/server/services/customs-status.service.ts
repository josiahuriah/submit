/** Persist and send one explicit secondary status request for an acknowledged QA submission. */
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { TenantClient } from '@/lib/db/tenant-client'
import { env } from '@/lib/env'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { buildSubmissionStatusSoapEnvelope } from '@/lib/beaip/transport/soap-envelope'
import {
  BeaipTransportError,
  postDeclarationSoap,
} from '@/lib/beaip/transport/http-gateway'
import {
  extractBeaipMessageId,
  parseBeaipResponse,
} from '@/lib/beaip/transport/response-parser'

export const customsStatusService = {
  async check(db: TenantClient, audit: AuditContext, customsEntryId: string) {
    const configuration = env()
    const isDevelopmentPreview = configuration.NODE_ENV === 'development'
    if (!isDevelopmentPreview && configuration.BEAIP_TRANSPORT_MODE !== 'live') {
      throw new BusinessRuleError('BEAIP transport is disabled. Enable the controlled QA transport before checking status.')
    }
    if (!configuration.BEAIP_USERNAME || !configuration.BEAIP_PASSWORD) {
      throw new BusinessRuleError('Add the QA username and password before checking submission status.')
    }
    if (!configuration.BEAIP_SENDER) {
      throw new BusinessRuleError('Add the Customs-provided BEAIP sender before checking submission status.')
    }

    const entry = await db.customsEntry.findUnique({
      where: { id: customsEntryId },
      select: {
        id: true,
        attempts: {
          where: { responsePayload: { not: null } },
          select: {
            id: true,
            attemptNumber: true,
            responsePayload: true,
            statusChecks: {
              select: { checkNumber: true, outcome: true },
              orderBy: { checkNumber: 'desc' },
              take: 1,
            },
          },
          orderBy: { attemptNumber: 'desc' },
        },
      },
    })
    if (!entry) throw new NotFoundError('Customs declaration artifact')
    const acknowledged = entry.attempts.flatMap((candidate) => {
      if (!candidate.responsePayload) return []
      try {
        const originalMessageId = extractBeaipMessageId(candidate.responsePayload)
        return originalMessageId ? [{ attempt: candidate, originalMessageId }] : []
      } catch {
        return []
      }
    })[0]
    if (!acknowledged) {
      throw new BusinessRuleError('A stored Customs acknowledgement is required before checking submission status.')
    }
    const { attempt, originalMessageId } = acknowledged
    if (attempt.statusChecks[0]?.outcome === 'PENDING') {
      throw new BusinessRuleError('A submission status check is still pending; reconcile it before checking again.')
    }

    const messageId = randomUUID()
    const checkNumber = (attempt.statusChecks[0]?.checkNumber ?? 0) + 1
    const soap = buildSubmissionStatusSoapEnvelope({
      username: configuration.BEAIP_USERNAME,
      password: configuration.BEAIP_PASSWORD,
      requestMessageId: messageId,
      originalMessageId,
      sender: configuration.BEAIP_SENDER,
      receiver: configuration.BEAIP_RECEIVER,
      requestedAt: new Date(),
      timeZone: configuration.BEAIP_TIMEZONE,
    })

    if (isDevelopmentPreview) {
      return {
        statusCheckId: null,
        checkNumber,
        messageId,
        originalMessageId,
        outcome: 'PREVIEW' as const,
        httpStatus: null,
        fault: null,
        responsePayload: null,
        soapEnvelope: soap.envelope,
        responseDownloadUrl: null,
      }
    }

    const statusCheck = await db.customsSubmissionStatusCheck.create({
      data: {
        submissionAttemptId: attempt.id,
        checkNumber,
        messageId,
        originalMessageId,
        redactedSoapEnvelope: soap.redactedEnvelope,
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
      await db.$tenantTransaction(async (tx) => {
        await tx.customsSubmissionStatusCheck.update({
          where: { id: statusCheck.id },
          data: {
            outcome,
            responsePayload: response.body,
            httpStatus: response.httpStatus,
            soapFaultCode: parsed.kind === 'SOAP_FAULT' ? parsed.faultCode : undefined,
            soapFaultReason: parsed.kind === 'SOAP_FAULT' ? parsed.faultReason : undefined,
            completedAt: new Date(),
          },
        })
        await tx.customsEntry.update({
          where: { id: entry.id },
          data: { responsePayload: response.body },
        })
      })
      await writeAudit(db, audit, {
        action: 'STATUS_CHANGE',
        entityType: 'CustomsSubmissionStatusCheck',
        entityId: statusCheck.id,
        changes: { after: { customsEntryId: entry.id, checkNumber, messageId, originalMessageId, outcome, httpStatus: response.httpStatus } },
      })
      return {
        statusCheckId: statusCheck.id,
        checkNumber,
        messageId,
        originalMessageId,
        outcome,
        httpStatus: response.httpStatus,
        fault: parsed.kind === 'SOAP_FAULT' ? { code: parsed.faultCode, reason: parsed.faultReason } : null,
        responsePayload: response.body,
        responseDownloadUrl: `/api/customs-entries/${entry.id}/status-response`,
      }
    } catch (error) {
      if (!(error instanceof BeaipTransportError)) throw error
      await db.customsSubmissionStatusCheck.update({
        where: { id: statusCheck.id },
        data: { outcome: error.outcome, completedAt: new Date() },
      })
      await writeAudit(db, audit, {
        action: 'STATUS_CHANGE',
        entityType: 'CustomsSubmissionStatusCheck',
        entityId: statusCheck.id,
        changes: { after: { customsEntryId: entry.id, checkNumber, messageId, originalMessageId, outcome: error.outcome } },
      })
      return {
        statusCheckId: statusCheck.id,
        checkNumber,
        messageId,
        originalMessageId,
        outcome: error.outcome,
        httpStatus: null,
        fault: null,
        responsePayload: null,
        responseDownloadUrl: null,
      }
    }
  },

  async getLatestResponse(db: TenantClient, customsEntryId: string) {
    const check = await db.customsSubmissionStatusCheck.findFirst({
      where: {
        submissionAttempt: { customsEntryId },
        responsePayload: { not: null },
      },
      select: {
        checkNumber: true,
        responsePayload: true,
        submissionAttempt: {
          select: {
            attemptNumber: true,
            customsEntry: {
              select: {
                declarationType: true,
                declarationGroupCode: true,
                declarationSequence: true,
                shipment: { select: { shipmentNumber: true } },
              },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    })
    if (!check?.responsePayload) throw new NotFoundError('Customs submission status response')
    const entry = check.submissionAttempt.customsEntry
    const safeReference = entry.shipment.shipmentNumber.replace(/[^A-Za-z0-9._-]+/g, '-')
    return {
      response: check.responsePayload,
      fileName: `${safeReference}-${entry.declarationType}-${entry.declarationGroupCode}-${entry.declarationSequence}-attempt-${check.submissionAttempt.attemptNumber}-status-${check.checkNumber}-response.xml`,
    }
  },
}
