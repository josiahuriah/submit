/**
 * Customs assessment-quantity conversions.
 *
 * These are deliberately separate from money calculations: a tariff rate is
 * only meaningful when the line's commercial quantity has been converted to
 * the unit named by the rate. The 0.22 / 153.6 / 160 factors below reproduce
 * the Bahamas Customs alcohol training material supplied for UAT. They are
 * versioned constants rather than "more accurate" scientific substitutions so
 * our result follows the reviewer's worksheet exactly.
 */
import { Decimal, d, type DecimalInput } from './money'

export type VolumeUnit = 'ML' | 'CL' | 'L' | 'US_FL_OZ' | 'IMP_FL_OZ' | 'IMP_GAL'
export type AlcoholStrengthBasis = 'ABV_PERCENT' | 'US_PROOF'

export interface AlcoholQuantityInput {
  /** Cases/packages represented by the commercial line quantity. */
  packageQuantity: DecimalInput
  unitsPerPackage: DecimalInput
  unitVolume: DecimalInput
  volumeUnit: VolumeUnit
  alcoholStrength?: DecimalInput | null
  alcoholStrengthBasis?: AlcoholStrengthBasis | null
}

export interface AlcoholQuantities {
  totalLitres: Decimal
  imperialGallons: Decimal
  /** Null when strength was not supplied. */
  proofGallons: Decimal | null
}

const LITRES_PER_UNIT: Partial<Record<VolumeUnit, string>> = {
  ML: '0.001',
  CL: '0.01',
  L: '1',
}

export function calculateAlcoholQuantities(input: AlcoholQuantityInput): AlcoholQuantities {
  const retailUnits = d(input.packageQuantity).times(d(input.unitsPerPackage))
  const totalDeclaredVolume = retailUnits.times(d(input.unitVolume))

  let totalLitres: Decimal
  let imperialGallons: Decimal

  if (input.volumeUnit === 'US_FL_OZ') {
    imperialGallons = totalDeclaredVolume.div('153.6')
    totalLitres = imperialGallons.div('0.22')
  } else if (input.volumeUnit === 'IMP_FL_OZ') {
    imperialGallons = totalDeclaredVolume.div('160')
    totalLitres = imperialGallons.div('0.22')
  } else if (input.volumeUnit === 'IMP_GAL') {
    imperialGallons = totalDeclaredVolume
    totalLitres = imperialGallons.div('0.22')
  } else {
    const factor = LITRES_PER_UNIT[input.volumeUnit]
    if (!factor) throw new Error(`Unsupported alcohol volume unit: ${input.volumeUnit}`)
    totalLitres = totalDeclaredVolume.times(factor)
    imperialGallons = totalLitres.times('0.22')
  }

  const strength = input.alcoholStrength
  if (strength === null || strength === undefined || !input.alcoholStrengthBasis) {
    return { totalLitres, imperialGallons, proofGallons: null }
  }

  const britishProof =
    input.alcoholStrengthBasis === 'US_PROOF'
      ? d(strength).times('0.875')
      : d(strength).times('1.75')
  const proofGallons = imperialGallons.times(britishProof.div('100'))

  return { totalLitres, imperialGallons, proofGallons }
}

export interface SpecificQuantityInput {
  lineQuantity: DecimalInput
  lineUnit: string
  unitsPerPackage?: DecimalInput | null
  unitVolume?: DecimalInput | null
  volumeUnit?: VolumeUnit | null
  alcoholStrength?: DecimalInput | null
  alcoholStrengthBasis?: AlcoholStrengthBasis | null
}

/**
 * Resolve the assessment quantity for a specific-rate unit. Ordinary units
 * use the commercial quantity; alcohol units require explicit package data.
 */
export function resolveSpecificQuantity(
  rateUnit: string | null | undefined,
  input: SpecificQuantityInput,
): Decimal {
  if (!rateUnit) return d(input.lineQuantity)
  const target = rateUnit.trim().toUpperCase()
  const lineUnit = input.lineUnit.trim().toUpperCase()

  if (target === lineUnit) return d(input.lineQuantity)

  if (target === 'IMP_GAL' || target === 'PROOF_GAL' || target === 'L') {
    // A bulk line can state its commercial quantity directly in litres or
    // imperial gallons; no bottle/package metadata is needed in that case.
    if (lineUnit === 'L' || lineUnit === 'IMP_GAL') {
      const totalLitres = lineUnit === 'L'
        ? d(input.lineQuantity)
        : d(input.lineQuantity).div('0.22')
      const imperialGallons = lineUnit === 'IMP_GAL'
        ? d(input.lineQuantity)
        : d(input.lineQuantity).times('0.22')
      if (target === 'L') return totalLitres
      if (target === 'IMP_GAL') return imperialGallons
      if (input.alcoholStrength === null || input.alcoholStrength === undefined || !input.alcoholStrengthBasis) {
        throw new Error('PROOF_GAL rates require alcohol strength and strength basis')
      }
      const britishProof = input.alcoholStrengthBasis === 'US_PROOF'
        ? d(input.alcoholStrength).times('0.875')
        : d(input.alcoholStrength).times('1.75')
      return imperialGallons.times(britishProof.div('100'))
    }

    if (
      input.unitsPerPackage === null ||
      input.unitsPerPackage === undefined ||
      input.unitVolume === null ||
      input.unitVolume === undefined ||
      !input.volumeUnit
    ) {
      throw new Error(
        `Rate unit ${target} requires units per package, unit volume, and volume unit`,
      )
    }

    const quantities = calculateAlcoholQuantities({
      packageQuantity: input.lineQuantity,
      unitsPerPackage: input.unitsPerPackage,
      unitVolume: input.unitVolume,
      volumeUnit: input.volumeUnit,
      alcoholStrength: input.alcoholStrength,
      alcoholStrengthBasis: input.alcoholStrengthBasis,
    })

    if (target === 'L') return quantities.totalLitres
    if (target === 'IMP_GAL') return quantities.imperialGallons
    if (!quantities.proofGallons) {
      throw new Error('PROOF_GAL rates require alcohol strength and strength basis')
    }
    return quantities.proofGallons
  }

  throw new Error(`Cannot convert ${lineUnit} to tariff assessment unit ${target}`)
}
