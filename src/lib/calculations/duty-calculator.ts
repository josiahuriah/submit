/**
 * Duty / VAT / levy / excise calculation engine.
 *
 * This is pure domain logic: no Prisma, no HTTP. It takes plain inputs and
 * returns plain Decimal outputs, which makes it trivially unit-testable and
 * reusable (API, background jobs, "what-if" calculators in the UI).
 *
 * Bahamian import-cost model implemented here:
 *   CIF        = FOB + apportioned freight + insurance + other
 *   Duty       = per dutyBasis:
 *                  AD_VALOREM: CIF × dutyRate
 *                  SPECIFIC:   quantity × specificRate   (alcohol, fuel, …)
 *                  COMPOUND:   greater of the two (per tariff notes)
 *                  ADDITIVE:   ad valorem + specific (e.g. beer)
 *   Excise     = independently AD_VALOREM / SPECIFIC / COMPOUND / ADDITIVE
 *   Env. levy  = CIF × levyRate
 *   VAT        = (CIF + duty + excise + levy) × vatRate
 *   Processing = 1% of shipment CIF, min $10, max $750 (shipment level),
 *                plus VAT on the fee itself.
 *
 * Exemptions:
 *   FULL        → duty, excise and levy are zeroed; VAT still applies to CIF
 *                 unless the caller also zeroes vatRate.
 *   PARTIAL /   → amounts are computed in full and flagged; the concession
 *   CONDITIONAL   percentage is applied by the caller (Phase 4 validation
 *                 work will formalize concession codes).
 *
 * Correct specific-rate handling for alcohol is a deliberate differentiator:
 * it is a documented accuracy gap in CayDeclarations.
 */
import { Decimal, d, toMoney, sum, clamp, ZERO, type DecimalInput } from './money'
import { apportion, type ApportionmentBasis } from './apportionment'

// --- Types -------------------------------------------------------------------

export type ChargeBasisInput = 'NONE' | 'AD_VALOREM' | 'SPECIFIC' | 'COMPOUND' | 'ADDITIVE'
export type DutyBasisInput = Exclude<ChargeBasisInput, 'NONE'>
export type ExemptionInput = 'NONE' | 'FULL' | 'PARTIAL' | 'CONDITIONAL'

export interface LineRates {
  dutyBasis: DutyBasisInput
  dutyRate: DecimalInput // fraction: 0.45 = 45%
  specificRate?: DecimalInput | null // BSD per unit
  vatRate: DecimalInput
  levyRate: DecimalInput
  /** Defaults to AD_VALOREM for backward-compatible ordinary excise rates. */
  exciseBasis?: ChargeBasisInput
  exciseRate: DecimalInput
  exciseSpecificRate?: DecimalInput | null
}

export interface CalculationLineInput {
  id: string
  totalValue: DecimalInput // line FOB in invoice currency
  /** BSD per one unit of invoice currency; defaults to 1. */
  exchangeRate?: DecimalInput
  quantity: DecimalInput
  dutyAssessmentQuantity?: DecimalInput | null
  exciseAssessmentQuantity?: DecimalInput | null
  weightKg?: DecimalInput | null
  rates: LineRates
  exemptionType?: ExemptionInput
}

export interface ShipmentChargesInput {
  freightCharge: DecimalInput
  insuranceCharge: DecimalInput
  otherCharges: DecimalInput
}

export interface CalculationOptions {
  apportionmentBasis?: ApportionmentBasis
  /** Processing fee parameters — current Bahamian rule: 1%, $10–$750. */
  processingFee?: {
    rate: DecimalInput
    minimum: DecimalInput
    maximum: DecimalInput
  }
}

export interface LineCalculationResult {
  id: string
  freightApportioned: Decimal
  insuranceApportioned: Decimal
  otherCostApportioned: Decimal
  fobValue: Decimal
  cifValue: Decimal
  dutyAmount: Decimal
  vatAmount: Decimal
  levyAmount: Decimal
  exciseAmount: Decimal
  lineTotalTaxes: Decimal
}

export interface ShipmentCalculationResult {
  lines: LineCalculationResult[]
  totalFobValue: Decimal
  totalCifValue: Decimal
  totalDuty: Decimal
  totalVat: Decimal
  totalLevy: Decimal
  totalExcise: Decimal
  processingFee: Decimal
  /** duty + vat + levy + excise + processing fee */
  totalPayable: Decimal
}

const DEFAULT_PROCESSING_FEE = {
  rate: '0.01',
  minimum: '10.00',
  maximum: '750.00',
}

// --- Engine --------------------------------------------------------------------

export function calculateShipment(
  lines: CalculationLineInput[],
  charges: ShipmentChargesInput,
  options: CalculationOptions = {},
): ShipmentCalculationResult {
  const basis = options.apportionmentBasis ?? 'VALUE'

  // 1. Apportion each shipment-level charge across lines (exact-sum).
  const fobById = new Map(
    lines.map((line) => [
      line.id,
      toMoney(d(line.totalValue).times(d(line.exchangeRate ?? '1'))),
    ]),
  )
  const apportionable = lines.map((l) => ({
    id: l.id,
    totalValue: fobById.get(l.id) ?? ZERO,
    weightKg: l.weightKg,
  }))
  const freightShares = indexById(apportion(charges.freightCharge, apportionable, basis))
  const insuranceShares = indexById(apportion(charges.insuranceCharge, apportionable, basis))
  const otherShares = indexById(apportion(charges.otherCharges, apportionable, basis))

  // 2. Per-line CIF + taxes.
  const lineResults = lines.map((line) => {
    const freight = freightShares.get(line.id) ?? ZERO
    const insurance = insuranceShares.get(line.id) ?? ZERO
    const other = otherShares.get(line.id) ?? ZERO
    const fob = fobById.get(line.id) ?? ZERO
    const cif = toMoney(fob.plus(freight).plus(insurance).plus(other))

    const exempt = line.exemptionType === 'FULL'

    const duty = exempt ? ZERO : calculateDuty(cif, line)
    const excise = exempt ? ZERO : calculateExcise(cif, line)
    const levy = exempt ? ZERO : toMoney(cif.times(d(line.rates.levyRate)))
    const vatBase = cif.plus(duty).plus(excise).plus(levy)
    const vat = toMoney(vatBase.times(d(line.rates.vatRate)))

    return {
      id: line.id,
      freightApportioned: freight,
      insuranceApportioned: insurance,
      otherCostApportioned: other,
      fobValue: fob,
      cifValue: cif,
      dutyAmount: duty,
      vatAmount: vat,
      levyAmount: levy,
      exciseAmount: excise,
      lineTotalTaxes: duty.plus(vat).plus(levy).plus(excise),
    }
  })

  // 3. Shipment roll-ups.
  const totalFobValue = toMoney(sum(lineResults.map((l) => l.fobValue)))
  const totalCifValue = toMoney(sum(lineResults.map((l) => l.cifValue)))
  const totalDuty = toMoney(sum(lineResults.map((l) => l.dutyAmount)))
  const totalLevy = toMoney(sum(lineResults.map((l) => l.levyAmount)))
  const totalExcise = toMoney(sum(lineResults.map((l) => l.exciseAmount)))

  // 4. Customs processing fee (shipment level) + VAT on the fee.
  const feeParams = options.processingFee ?? DEFAULT_PROCESSING_FEE
  const rawFee = totalCifValue.times(d(feeParams.rate))
  const processingFee = toMoney(clamp(rawFee, d(feeParams.minimum), d(feeParams.maximum)))
  const vatOnFee = toMoney(processingFee.times(effectiveVatRate(lines)))

  const totalVat = toMoney(sum(lineResults.map((l) => l.vatAmount)).plus(vatOnFee))
  const totalPayable = toMoney(
    totalDuty.plus(totalVat).plus(totalLevy).plus(totalExcise).plus(processingFee),
  )

  return {
    lines: lineResults,
    totalFobValue,
    totalCifValue,
    totalDuty,
    totalVat,
    totalLevy,
    totalExcise,
    processingFee,
    totalPayable,
  }
}

/** Duty for a single line according to its basis. */
export function calculateDuty(cif: Decimal, line: CalculationLineInput): Decimal {
  const { dutyBasis, dutyRate, specificRate } = line.rates
  return calculateCharge(
    cif,
    dutyBasis,
    dutyRate,
    specificRate,
    line.dutyAssessmentQuantity ?? line.quantity,
  )
}

/** Excise is its own charge domain; it must never borrow the duty basis. */
export function calculateExcise(cif: Decimal, line: CalculationLineInput): Decimal {
  return calculateCharge(
    cif,
    line.rates.exciseBasis ?? 'AD_VALOREM',
    line.rates.exciseRate,
    line.rates.exciseSpecificRate,
    line.exciseAssessmentQuantity ?? line.quantity,
  )
}

function calculateCharge(
  cif: Decimal,
  basis: ChargeBasisInput,
  adValoremRate: DecimalInput,
  specificRate: DecimalInput | null | undefined,
  assessmentQuantity: DecimalInput,
): Decimal {
  const adValorem = toMoney(cif.times(d(adValoremRate)))
  const specific = toMoney(d(assessmentQuantity).times(d(specificRate)))

  switch (basis) {
    case 'NONE':
      return ZERO
    case 'AD_VALOREM':
      return adValorem
    case 'SPECIFIC':
      return specific
    case 'COMPOUND':
      return Decimal.max(adValorem, specific)
    case 'ADDITIVE':
      return toMoney(adValorem.plus(specific))
  }
}

/**
 * VAT rate used for the processing-fee VAT. Standard rate is uniform across
 * lines in practice; take the highest line rate defensively.
 */
function effectiveVatRate(lines: CalculationLineInput[]): Decimal {
  return lines.reduce<Decimal>((max, l) => Decimal.max(max, d(l.rates.vatRate)), ZERO)
}

function indexById(entries: { id: string; amount: Decimal }[]): Map<string, Decimal> {
  return new Map(entries.map((e) => [e.id, e.amount]))
}
