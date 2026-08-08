/**
 * Calculations service — the bridge between the pure calculation engine and
 * the database.
 *
 * Flow:
 *   1. Load the shipment with all line items (single query, select-shaped).
 *   2. Resolve each line's CURRENT HSCodeRate (effectiveTo IS NULL).
 *   3. Run calculateShipment() — pure, deterministic, unit-tested.
 *   4. Persist in ONE transaction: every line's frozen rates + amounts, plus
 *      shipment roll-ups. Freezing rates on the line is what makes historical
 *      shipments auditable after a tariff change.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { shipmentsRepository } from '@/server/repositories/shipments.repository'
import {
  calculateShipment,
  type CalculationLineInput,
} from '@/lib/calculations/duty-calculator'
import { moneyString } from '@/lib/calculations/money'
import { resolveSpecificQuantity } from '@/lib/calculations/measurement'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import type { ApportionmentBasis } from '@/lib/calculations/apportionment'

interface RateRow {
  hsCodeId: string
  dutyBasis: 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
  dutyRate: unknown
  specificRate: unknown
  specificRateUnit: string | null
  vatRate: unknown
  levyRate: unknown
  exciseBasis: 'NONE' | 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
  exciseRate: unknown
  exciseSpecificRate: unknown
  exciseSpecificRateUnit: string | null
  isVerified: boolean
  sourceName: string | null
}

function usesSpecific(basis: RateRow['dutyBasis'] | RateRow['exciseBasis']): boolean {
  return basis === 'SPECIFIC' || basis === 'COMPOUND' || basis === 'ADDITIVE'
}

export const calculationsService = {
  async calculate(
    db: TenantClient,
    audit: AuditContext,
    shipmentId: string,
    options: { apportionmentBasis: ApportionmentBasis },
  ) {
    const shipment = await shipmentsRepository.withLineItemsForCalculation(db, shipmentId)
    if (!shipment) throw new NotFoundError('Shipment')
    if (shipment.status !== 'DRAFT') {
      throw new BusinessRuleError('Only DRAFT shipments can be recalculated')
    }

    const lineItems = shipment.invoices.flatMap((inv) =>
      inv.lineItems.map((line) => ({ ...line, exchangeRate: inv.exchangeRate })),
    )
    if (lineItems.length === 0) {
      throw new BusinessRuleError('Shipment has no line items to calculate')
    }
    const missingHs = lineItems.filter((l) => !l.hsCodeId)
    if (missingHs.length > 0) {
      throw new BusinessRuleError(
        `${missingHs.length} line item(s) have no HS code assigned`,
        { lineItemIds: missingHs.map((l) => l.id) },
      )
    }

    // 2. Current rates for every distinct HS code in one query.
    const hsCodeIds = [...new Set(lineItems.map((l) => l.hsCodeId as string))]
    const rates = (await db.hSCodeRate.findMany({
      where: {
        hsCodeId: { in: hsCodeIds },
        effectiveFrom: { lte: shipment.declarationDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: shipment.declarationDate } }],
      },
      select: {
        hsCodeId: true,
        dutyBasis: true,
        dutyRate: true,
        specificRate: true,
        specificRateUnit: true,
        vatRate: true,
        levyRate: true,
        exciseBasis: true,
        exciseRate: true,
        exciseSpecificRate: true,
        exciseSpecificRateUnit: true,
        isVerified: true,
        sourceName: true,
      },
      orderBy: { effectiveFrom: 'desc' },
    })) as RateRow[]
    // Ordered newest-first: retain the first matching version per HS code.
    const rateByHsCode = new Map<string, RateRow>()
    for (const rate of rates) {
      if (!rateByHsCode.has(rate.hsCodeId)) rateByHsCode.set(rate.hsCodeId, rate)
    }

    const missingRates = hsCodeIds.filter((idV) => !rateByHsCode.has(idV))
    if (missingRates.length > 0) {
      throw new BusinessRuleError('Some HS codes have no active rate record', {
        hsCodeIds: missingRates,
      })
    }


    // The PDF extraction is duty-only. Applying its zero/default excise to an
    // excisable chapter would silently understate tax, so those lines require
    // a separately verified legal-source rate before calculation can proceed.
    const excisableChapters = new Set(['22', '24', '27', '87'])
    const unverifiedExcisable = lineItems.filter((line) => {
      const rate = rateByHsCode.get(line.hsCodeId as string)
      return excisableChapters.has(line.hsCode.slice(0, 2)) && !rate?.isVerified
    })
    if (unverifiedExcisable.length > 0) {
      throw new BusinessRuleError(
        'One or more excisable tariff lines do not have a verified rate source',
        { hsCodes: [...new Set(unverifiedExcisable.map((line) => line.hsCode))] },
      )
    }

    // 3. Run the engine.
    const assessmentByLine = new Map<
      string,
      { duty: string | null; excise: string | null }
    >()
    const engineLines: CalculationLineInput[] = lineItems.map((l) => {
      const rate = rateByHsCode.get(l.hsCodeId as string)!
      const measurement = {
        lineQuantity: String(l.quantity),
        lineUnit: l.unit,
        unitsPerPackage: l.unitsPerPackage,
        unitVolume: l.unitVolume === null ? null : String(l.unitVolume),
        volumeUnit: l.volumeUnit,
        alcoholStrength: l.alcoholStrength === null ? null : String(l.alcoholStrength),
        alcoholStrengthBasis: l.alcoholStrengthBasis,
      }
      let dutyAssessment: string | null = null
      let exciseAssessment: string | null = null
      try {
        if (usesSpecific(rate.dutyBasis)) {
          dutyAssessment = resolveSpecificQuantity(rate.specificRateUnit, measurement).toFixed(6)
        }
        if (usesSpecific(rate.exciseBasis)) {
          exciseAssessment = resolveSpecificQuantity(
            rate.exciseSpecificRateUnit,
            measurement,
          ).toFixed(6)
        }
      } catch (error) {
        throw new BusinessRuleError(
          `Line ${l.hsCode} is missing measurement data required by its tariff rate`,
          {
            lineItemId: l.id,
            detail: error instanceof Error ? error.message : 'Assessment quantity could not be resolved',
          },
        )
      }
      assessmentByLine.set(l.id, { duty: dutyAssessment, excise: exciseAssessment })
      return {
        id: l.id,
        totalValue: String(l.totalValue),
        exchangeRate: String(l.exchangeRate),
        quantity: String(l.quantity),
        dutyAssessmentQuantity: dutyAssessment,
        exciseAssessmentQuantity: exciseAssessment,
        weightKg: l.weightKg === null ? null : String(l.weightKg),
        exemptionType: l.exemptionType,
        rates: {
          dutyBasis: rate.dutyBasis,
          dutyRate: String(rate.dutyRate),
          specificRate: rate.specificRate === null ? null : String(rate.specificRate),
          vatRate: String(rate.vatRate),
          levyRate: String(rate.levyRate),
          exciseBasis: rate.exciseBasis,
          exciseRate: String(rate.exciseRate),
          exciseSpecificRate:
            rate.exciseSpecificRate === null ? null : String(rate.exciseSpecificRate),
        },
      }
    })

    const result = calculateShipment(
      engineLines,
      {
        freightCharge: String(shipment.freightCharge),
        insuranceCharge: String(shipment.insuranceCharge),
        otherCharges: String(shipment.otherCharges),
      },
      { apportionmentBasis: options.apportionmentBasis },
    )

    // 4. Persist atomically: line updates + shipment roll-up.
    const lineById = new Map(lineItems.map((l) => [l.id, l]))
    const calculatedAt = new Date()

    await db.$tenantTransaction(async (tx) => {
      for (const line of result.lines) {
        const source = lineById.get(line.id)!
        const rate = rateByHsCode.get(source.hsCodeId as string)!
        const assessment = assessmentByLine.get(line.id)!
        await tx.lineItem.update({
          where: { id: line.id },
          data: {
            freightApportioned: moneyString(line.freightApportioned),
            insuranceApportioned: moneyString(line.insuranceApportioned),
            otherCostApportioned: moneyString(line.otherCostApportioned),
            fobValueBsd: moneyString(line.fobValue),
            cifValue: moneyString(line.cifValue),
            dutyAmount: moneyString(line.dutyAmount),
            vatAmount: moneyString(line.vatAmount),
            levyAmount: moneyString(line.levyAmount),
            exciseAmount: moneyString(line.exciseAmount),
            // Freeze the applied rates for auditability.
            dutyBasis: rate.dutyBasis,
            dutyRate: String(rate.dutyRate),
            specificRate: rate.specificRate === null ? null : String(rate.specificRate),
            specificRateUnit: rate.specificRateUnit,
            dutyAssessmentQuantity: assessment.duty,
            vatRate: String(rate.vatRate),
            levyRate: String(rate.levyRate),
            exciseBasis: rate.exciseBasis,
            exciseRate: String(rate.exciseRate),
            exciseSpecificRate:
              rate.exciseSpecificRate === null ? null : String(rate.exciseSpecificRate),
            exciseSpecificRateUnit: rate.exciseSpecificRateUnit,
            exciseAssessmentQuantity: assessment.excise,
          },
        })
      }
      await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          totalFobValue: moneyString(result.totalFobValue),
          totalCifValue: moneyString(result.totalCifValue),
          totalDuty: moneyString(result.totalDuty),
          totalVat: moneyString(result.totalVat),
          totalLevy: moneyString(result.totalLevy),
          totalExcise: moneyString(result.totalExcise),
          processingFee: moneyString(result.processingFee),
          totalPayable: moneyString(result.totalPayable),
          calculatedAt,
        },
      })
    })

    await writeAudit(db, audit, {
      action: 'UPDATE',
      entityType: 'Shipment',
      entityId: shipmentId,
      changes: {
        after: {
          event: 'CALCULATED',
          totalPayable: moneyString(result.totalPayable),
          lineCount: result.lines.length,
          rateDate: shipment.declarationDate.toISOString(),
        },
      },
    })

    return {
      shipmentId,
      calculatedAt,
      totals: {
        totalFobValue: moneyString(result.totalFobValue),
        totalCifValue: moneyString(result.totalCifValue),
        totalDuty: moneyString(result.totalDuty),
        totalVat: moneyString(result.totalVat),
        totalLevy: moneyString(result.totalLevy),
        totalExcise: moneyString(result.totalExcise),
        processingFee: moneyString(result.processingFee),
        totalPayable: moneyString(result.totalPayable),
      },
      lines: result.lines.map((l) => ({
        id: l.id,
        fobValueBsd: moneyString(l.fobValue),
        cifValue: moneyString(l.cifValue),
        dutyAmount: moneyString(l.dutyAmount),
        vatAmount: moneyString(l.vatAmount),
        levyAmount: moneyString(l.levyAmount),
        exciseAmount: moneyString(l.exciseAmount),
      })),
    }
  },
}
