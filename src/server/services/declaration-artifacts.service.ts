/**
 * Customs-review XML artifacts.
 *
 * This workflow is deliberately separate from declarationsService.submit():
 * it maps, preflights, serializes, and records an immutable review artifact,
 * but it never calls a Customs endpoint or advances the Shipment status.
 */
import { XMLValidator } from 'fast-xml-parser'
import type { TenantClient } from '@/lib/db/tenant-client'
import { buildWcoDeclarationXml } from '@/lib/beaip/wco-xml'
import { preflightTfpDeclaration } from '@/lib/beaip/tfp-field-mapping'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import type { DeclarationType } from '@/generated/prisma/enums'
import { loadDeclarationSource, toBeaipDeclaration } from './declaration-mapper'

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

function artifactFileName(shipmentNumber: string, declarationType: string): string {
  const safeReference = shipmentNumber.replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${safeReference}-${declarationType}-review.xml`
}

export const declarationArtifactsService = {
  async generate(
    db: TenantClient,
    audit: AuditContext,
    shipmentId: string,
    input: { declarationType: DeclarationType; functionCode?: '9' | '5' | '1' },
  ) {
    const shipment = await loadDeclarationSource(db, shipmentId)
    if (!shipment) throw new NotFoundError('Shipment')
    if (shipment.status !== 'DRAFT') {
      throw new BusinessRuleError(
        `Shipment is ${shipment.status}; review XML can only be regenerated while it is DRAFT`,
      )
    }
    assertCalculationCurrent(shipment)

    const mapped = toBeaipDeclaration(shipment, input.declarationType)
    const declaration = input.functionCode
      ? { ...mapped, functionCode: input.functionCode }
      : mapped
    const preflight = preflightTfpDeclaration(declaration)
    if (!preflight.ready) {
      throw new BusinessRuleError('Declaration is not ready for Customs review', {
        issues: preflight.issues,
      })
    }

    const generatedAt = new Date()
    const xml = buildWcoDeclarationXml(declaration, {
      functionCode: declaration.functionCode,
      acceptanceDateTime: generatedAt,
    })
    const wellFormedResult = XMLValidator.validate(xml)
    if (wellFormedResult !== true) {
      throw new BusinessRuleError('Generated declaration XML is not well formed', {
        xmlValidation: wellFormedResult,
      })
    }

    const validationReport = {
      ...preflight,
      wellFormed: true,
      xsdValidation: {
        status: 'STRUCTURE_CONTRACT_TESTED',
        commonTypes: 'PERMISSIVE_STUB',
        note: 'The builder is tested against TFB_WCO_DEC_v1.4.4 plus a permissive TFB_Common_Types stub. Customs must supply the official common types and perform its independent schema and business validation.',
      },
    }
    const entry = await db.customsEntry.create({
      data: {
        shipmentId: shipment.id,
        declarationType: input.declarationType,
        // Reserve VALIDATED for a pass against the official common-types schema.
        status: 'DRAFT',
        functionCode: declaration.functionCode,
        regimeCode: declaration.regimeCode,
        schemaVersion: preflight.schemaVersion,
        mappingVersion: preflight.mappingVersion,
        generatedAt,
        validationReport: JSON.parse(JSON.stringify(validationReport)),
        requestPayload: xml,
        totalPayable: String(shipment.totalPayable),
      } as never,
      select: {
        id: true,
        status: true,
        declarationType: true,
        functionCode: true,
        regimeCode: true,
        schemaVersion: true,
        mappingVersion: true,
        generatedAt: true,
      },
    })

    await writeAudit(db, audit, {
      action: 'CREATE',
      entityType: 'CustomsReviewXml',
      entityId: entry.id,
      changes: {
        after: {
          shipmentNumber: shipment.shipmentNumber,
          schemaVersion: preflight.schemaVersion,
          mappingVersion: preflight.mappingVersion,
          functionCode: declaration.functionCode,
        },
      },
    })

    return {
      artifact: entry,
      fileName: artifactFileName(shipment.shipmentNumber, input.declarationType),
      downloadUrl: `/api/customs-entries/${entry.id}/xml`,
      validation: validationReport,
    }
  },

  async getXml(db: TenantClient, artifactId: string) {
    const entry = await db.customsEntry.findUnique({
      where: { id: artifactId },
      select: {
        id: true,
        shipment: { select: { shipmentNumber: true } },
        declarationType: true,
        requestPayload: true,
      },
    })
    if (!entry || typeof entry.requestPayload !== 'string') {
      throw new NotFoundError('Customs review XML artifact')
    }
    return {
      xml: entry.requestPayload,
      fileName: artifactFileName(entry.shipment.shipmentNumber, entry.declarationType),
    }
  },
}
