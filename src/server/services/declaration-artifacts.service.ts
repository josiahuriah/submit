/**
 * Customs-review XML artifacts.
 *
 * This workflow is deliberately separate from declarationsService.submit():
 * it maps, preflights, serializes, and records an immutable review artifact,
 * but it never calls a Customs endpoint or advances the Shipment status.
 */
import { XMLValidator } from 'fast-xml-parser'
import { createHash, randomUUID } from 'node:crypto'
import type { TenantClient } from '@/lib/db/tenant-client'
import { buildWcoDeclarationXml } from '@/lib/beaip/wco-xml'
import { preflightTfpDeclaration } from '@/lib/beaip/tfp-field-mapping'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import { env } from '@/lib/env'
import type { DeclarationType } from '@/generated/prisma/enums'
import {
  loadDeclarationSource,
  partitionBeaipDeclaration,
  toBeaipDeclaration,
} from './declaration-mapper'

function assertCalculationCurrent(shipment: {
  calculatedAt: Date | null
  updatedAt: Date
}) {
  if (!shipment.calculatedAt) {
    throw new BusinessRuleError('Run the duty calculation before generating review XML')
  }
  const driftMs = shipment.updatedAt.getTime() - shipment.calculatedAt.getTime()
  if (driftMs > 5_000) {
    throw new BusinessRuleError(
      'Shipment changed after the last calculation — recalculate before generating review XML',
    )
  }
}

function artifactFileName(shipmentNumber: string, declarationType: string, groupCode?: string): string {
  const safeReference = shipmentNumber.replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${safeReference}-${declarationType}${groupCode ? `-${groupCode}` : ''}-review.xml`
}

export const declarationArtifactsService = {
  async generate(
    db: TenantClient,
    audit: AuditContext,
    shipmentId: string,
    input: { declarationType: DeclarationType },
  ) {
    const shipment = await loadDeclarationSource(db, shipmentId)
    if (!shipment) throw new NotFoundError('Shipment')
    if (shipment.status !== 'DRAFT') {
      throw new BusinessRuleError(
        `Shipment is ${shipment.status}; review XML can only be regenerated while it is DRAFT`,
      )
    }
    assertCalculationCurrent(shipment)
    if (!audit.userId) throw new BusinessRuleError('A signed-in user is required to generate a submission batch')

    const generatedAt = new Date()
    const batchId = randomUUID()
    let declarations
    try {
      declarations = partitionBeaipDeclaration(
        toBeaipDeclaration(shipment, input.declarationType, env().BEAIP_BROKER_CODE),
        batchId,
      )
    } catch (error) {
      throw new BusinessRuleError(error instanceof Error ? error.message : 'Could not partition declaration')
    }
    const prepared = declarations.map((declaration) => {
      const preflight = preflightTfpDeclaration(declaration)
      if (!preflight.ready) {
        throw new BusinessRuleError('Declaration is not ready for Customs review', { issues: preflight.issues })
      }
      const xml = buildWcoDeclarationXml(declaration, {
        functionCode: declaration.functionCode,
        acceptanceDateTime: generatedAt,
      })
      const wellFormedResult = XMLValidator.validate(xml)
      if (wellFormedResult !== true) {
        throw new BusinessRuleError('Generated declaration XML is not well formed', { xmlValidation: wellFormedResult })
      }
      const validationReport = {
        ...preflight,
        wellFormed: true,
        xsdValidation: {
          status: 'STRUCTURE_CONTRACT_TESTED',
          commonTypes: 'PERMISSIVE_STUB',
          note: 'Customs business validation remains authoritative.',
        },
      }
      return {
        declaration,
        xml,
        declarationHash: createHash('sha256').update(xml, 'utf8').digest('hex'),
        validationReport,
      }
    })

    const artifacts = await db.$tenantTransaction(async (tx) => {
      await tx.customsSubmissionBatch.create({
        data: {
          id: batchId,
          organizationId: shipment.organization.id,
          shipmentId: shipment.id,
          createdById: audit.userId!,
          declarationCount: prepared.length,
        },
        select: { id: true },
      })
      const rows = []
      for (const item of prepared) {
        const { declaration, xml, declarationHash, validationReport } = item
        const entry = await tx.customsEntry.create({
          data: {
            organizationId: shipment.organization.id,
            shipmentId: shipment.id,
            submissionBatchId: batchId,
            declarationType: input.declarationType,
            status: 'DRAFT',
            functionCode: declaration.functionCode,
            regimeCode: declaration.regimeCode,
            schemaVersion: validationReport.schemaVersion,
            mappingVersion: validationReport.mappingVersion,
            generatedAt,
            validationReport: JSON.parse(JSON.stringify(validationReport)),
            declarationGroupCode: declaration.declarationGroupCode,
            declarationSequence: declaration.declarationSequence,
            functionalReferenceId: declaration.functionalReferenceId,
            brokerReference: declaration.brokerReference,
            declarationHash,
            requestPayload: xml,
            totalPayable: declaration.totalPayable,
          },
          select: {
            id: true, status: true, declarationType: true, functionCode: true,
            regimeCode: true, schemaVersion: true, mappingVersion: true,
            generatedAt: true, declarationGroupCode: true,
          },
        })
        rows.push({
          artifact: entry,
          fileName: artifactFileName(shipment.shipmentNumber, input.declarationType, declaration.declarationGroupCode),
          downloadUrl: `/api/customs-entries/${entry.id}/xml`,
          validation: validationReport,
        })
      }
      return rows
    })

    await writeAudit(db, audit, {
      action: 'CREATE',
      entityType: 'CustomsReviewXml',
      entityId: batchId,
      changes: {
        after: {
          shipmentNumber: shipment.shipmentNumber,
          declarationCount: artifacts.length,
          groups: prepared.map((item) => item.declaration.declarationGroupCode),
          functionCode: '9',
        },
      },
    })

    return {
      batchId,
      artifacts,
    }
  },

  async getXml(db: TenantClient, artifactId: string) {
    const entry = await db.customsEntry.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        shipment: { select: { shipmentNumber: true } },
        declarationType: true,
        declarationGroupCode: true,
        requestPayload: true,
      },
    })
    if (!entry || typeof entry.requestPayload !== 'string') {
      throw new NotFoundError('Customs review XML artifact')
    }
    return {
      xml: entry.requestPayload,
      fileName: artifactFileName(entry.shipment.shipmentNumber, entry.declarationType, entry.declarationGroupCode),
    }
  },
}
