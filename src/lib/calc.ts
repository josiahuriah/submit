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

import type { HsRate, LineCharges } from "./types";

/**
 * Compute a preview of charges for a single line.
 * @param line   the qty + unit price being entered (strings are coerced)
 * @param rate   the HS code's current rates, or null if not yet chosen
 */
export function previewLine(
  line: { quantity: number | string; unitPrice: number | string },
  rate: HsRate | null
): LineCharges {
  const qty = Number(line.quantity) || 0;
  const price = Number(line.unitPrice) || 0;
  const fob = qty * price;

  if (!rate) {
    return { fob, duty: 0, excise: 0, levy: 0, vat: 0, payable: 0 };
  }

  // A rate.excise value > 1 is treated as a per-unit SPECIFIC amount (alcohol,
  // fuel), otherwise it's an ad-valorem fraction of FOB.
  const excise = rate.excise > 1 ? qty * rate.excise : fob * (rate.excise || 0);
  const duty = fob * (rate.duty || 0);
  const levy = fob * (rate.levy || 0);
  const vat = (fob + duty + excise + levy) * (rate.vat || 0);

  return { fob, duty, excise, levy, vat, payable: duty + excise + levy + vat };
}

/** Shipment-level processing fee: 1% of total CIF, min $10, max $750. */
export function processingFee(totalCif: number): number {
  return Math.min(Math.max(totalCif * 0.01, 10), 750);
}
