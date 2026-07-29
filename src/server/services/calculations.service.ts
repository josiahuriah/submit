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
import { writeAudit, type AuditContext } from '@/lib/audit'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import type { ApportionmentBasis } from '@/lib/calculations/apportionment'

interface RateRow {
  hsCodeId: string
  dutyBasis: 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND'
  dutyRate: unknown
  specificRate: unknown
  specificRateUnit: string | null
  vatRate: unknown
  levyRate: unknown
  exciseRate: unknown
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

    const lineItems = shipment.invoices.flatMap((inv) => inv.lineItems)
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
      where: { hsCodeId: { in: hsCodeIds }, effectiveTo: null },
      select: {
        hsCodeId: true,
        dutyBasis: true,
        dutyRate: true,
        specificRate: true,
        specificRateUnit: true,
        vatRate: true,
        levyRate: true,
        exciseRate: true,
      },
    })) as RateRow[]
    const rateByHsCode = new Map(rates.map((r) => [r.hsCodeId, r]))

    const missingRates = hsCodeIds.filter((idV) => !rateByHsCode.has(idV))
    if (missingRates.length > 0) {
      throw new BusinessRuleError('Some HS codes have no active rate record', {
        hsCodeIds: missingRates,
      })
    }

    // 3. Run the engine.
    const engineLines: CalculationLineInput[] = lineItems.map((l) => {
      const rate = rateByHsCode.get(l.hsCodeId as string)!
      return {
        id: l.id,
        totalValue: String(l.totalValue),
        quantity: String(l.quantity),
        weightKg: l.weightKg === null ? null : String(l.weightKg),
        exemptionType: l.exemptionType,
        rates: {
          dutyBasis: rate.dutyBasis,
          dutyRate: String(rate.dutyRate),
          specificRate: rate.specificRate === null ? null : String(rate.specificRate),
          vatRate: String(rate.vatRate),
          levyRate: String(rate.levyRate),
          exciseRate: String(rate.exciseRate),
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
        await tx.lineItem.update({
          where: { id: line.id },
          data: {
            freightApportioned: moneyString(line.freightApportioned),
            insuranceApportioned: moneyString(line.insuranceApportioned),
            otherCostApportioned: moneyString(line.otherCostApportioned),
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
            vatRate: String(rate.vatRate),
            levyRate: String(rate.levyRate),
            exciseRate: String(rate.exciseRate),
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
        cifValue: moneyString(l.cifValue),
        dutyAmount: moneyString(l.dutyAmount),
        vatAmount: moneyString(l.vatAmount),
        levyAmount: moneyString(l.levyAmount),
        exciseAmount: moneyString(l.exciseAmount),
      })),
    }
  },
}
