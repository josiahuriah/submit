/**
 * CLIENT-SIDE DUTY PREVIEW
 * -----------------------------------------------------------------------------
 * IMPORTANT: This is NOT the authoritative calculation engine. Your server has
 * the real one (decimal.js precision, cost apportionment across lines,
 * exemptions, the compound/specific duty bases). This file exists purely to
 * give the entry row an INSTANT preview as the broker types, before the line
 * is committed and the server recomputes the canonical numbers.
 *
 * Keep the two in sync conceptually, but never treat this output as final —
 * always persist what the server returns.
 *
 * Bahamian model (simplified for preview):
 *   FOB     = qty * unitPrice
 *   Duty    = FOB * dutyRate           (ad valorem) — or qty * rate for SPECIFIC
 *   Excise  = FOB * exciseRate         — or qty * rate for SPECIFIC (alcohol)
 *   Levy    = FOB * levyRate
 *   VAT     = (FOB + duty + excise + levy) * vatRate
 *   Payable = duty + excise + levy + vat
 */

import { calculateShipment } from "./calculations/duty-calculator";
import { resolveSpecificQuantity } from "./calculations/measurement";
import { d } from "./calculations/money";
import type { HsRate, LineCharges, LineDraft } from "./types";

/**
 * Compute a preview of charges for a single line.
 * @param line   the qty + unit price being entered (strings are coerced)
 * @param rate   the HS code's current rates, or null if not yet chosen
 */
export function previewLine(
  line: LineDraft,
  rate: HsRate | null
): LineCharges {
  const quantity = d(line.quantity || "0");
  const fob = quantity.times(d(line.unitPrice || "0"));

  if (!rate) {
    return { fob: fob.toNumber(), duty: 0, excise: 0, levy: 0, vat: 0, payable: 0 };
  }

  const specificQuantity = (unit: string | null) => {
    try {
      return resolveSpecificQuantity(unit, {
        lineQuantity: quantity,
        lineUnit: line.unit,
        unitsPerPackage: line.unitsPerPackage || null,
        unitVolume: line.unitVolume || null,
        volumeUnit: line.unitVolume ? line.volumeUnit : null,
        alcoholStrength: line.alcoholStrength || null,
        alcoholStrengthBasis: line.alcoholStrength ? line.alcoholStrengthBasis : null,
      });
    } catch {
      return d(0);
    }
  };

  const calculated = calculateShipment([
    {
      id: "preview",
      totalValue: fob,
      quantity,
      dutyAssessmentQuantity: specificQuantity(rate.specificRateUnit),
      exciseAssessmentQuantity: specificQuantity(rate.exciseSpecificRateUnit),
      rates: {
        dutyBasis: rate.dutyBasis,
        dutyRate: rate.duty,
        specificRate: rate.specificRate,
        vatRate: rate.vat,
        levyRate: rate.levy,
        exciseBasis: rate.exciseBasis,
        exciseRate: rate.excise,
        exciseSpecificRate: rate.exciseSpecificRate,
      },
    },
  ], { freightCharge: 0, insuranceCharge: 0, otherCharges: 0 });
  const result = calculated.lines[0]!;

  return {
    fob: fob.toNumber(),
    duty: result.dutyAmount.toNumber(),
    excise: result.exciseAmount.toNumber(),
    levy: result.levyAmount.toNumber(),
    vat: result.vatAmount.toNumber(),
    payable: result.lineTotalTaxes.toNumber(),
  };
}

/** Shipment-level processing fee: 1% of total CIF, min $10, max $750. */
export function processingFee(totalCif: number): number {
  return Math.min(Math.max(totalCif * 0.01, 10), 750);
}
