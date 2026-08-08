import { describe, expect, it } from 'vitest'
import { apportion } from '@/lib/calculations/apportionment'
import { calculateShipment } from '@/lib/calculations/duty-calculator'
import { calculateAlcoholQuantities, resolveSpecificQuantity } from '@/lib/calculations/measurement'
import { Decimal, sum, toMoney } from '@/lib/calculations/money'

const eq = (a: Decimal, b: string) => expect(a.toFixed(2)).toBe(b)

describe('apportion', () => {
  it('splits proportionally by value', () => {
    const result = apportion('100.00', [
      { id: 'a', totalValue: '750.00' },
      { id: 'b', totalValue: '250.00' },
    ])
    eq(result[0]!.amount, '75.00')
    eq(result[1]!.amount, '25.00')
  })

  it('sums exactly to the charge even with awkward thirds', () => {
    const result = apportion('100.00', [
      { id: 'a', totalValue: '1' },
      { id: 'b', totalValue: '1' },
      { id: 'c', totalValue: '1' },
    ])
    eq(toMoney(sum(result.map((r) => r.amount))), '100.00')
    // Largest-remainder: 33.34 / 33.33 / 33.33 in deterministic order.
    eq(result[0]!.amount, '33.34')
    eq(result[1]!.amount, '33.33')
    eq(result[2]!.amount, '33.33')
  })

  it('sums exactly across many uneven lines (stress the remainder logic)', () => {
    const lines = Array.from({ length: 97 }, (_, i) => ({
      id: `l${i}`,
      totalValue: (Math.round((i + 1) * 13.37 * 100) / 100).toFixed(2),
    }))
    const result = apportion('4321.99', lines)
    eq(toMoney(sum(result.map((r) => r.amount))), '4321.99')
  })

  it('supports weight basis with value fallback for missing weights', () => {
    const result = apportion('90.00', [
      { id: 'heavy', totalValue: '10.00', weightKg: '200' },
      { id: 'light', totalValue: '10.00', weightKg: '100' },
    ], 'WEIGHT')
    eq(result[0]!.amount, '60.00')
    eq(result[1]!.amount, '30.00')
  })

  it('splits equally when the basis is all zeros', () => {
    const result = apportion('10.00', [
      { id: 'a', totalValue: '0' },
      { id: 'b', totalValue: '0' },
    ])
    eq(result[0]!.amount, '5.00')
    eq(result[1]!.amount, '5.00')
  })
})

describe('calculateShipment', () => {
  const standardRates = {
    dutyBasis: 'AD_VALOREM' as const,
    dutyRate: '0.45',
    vatRate: '0.10',
    levyRate: '0',
    exciseRate: '0',
  }

  it('computes CIF, duty, VAT and processing fee for a simple shipment', () => {
    const result = calculateShipment(
      [{ id: 'l1', totalValue: '1000.00', quantity: '10', rates: standardRates }],
      { freightCharge: '150.00', insuranceCharge: '30.00', otherCharges: '20.00' },
    )
    // CIF = 1000 + 150 + 30 + 20 = 1200
    eq(result.totalCifValue, '1200.00')
    // Duty = 1200 × 0.45 = 540
    eq(result.totalDuty, '540.00')
    // Processing fee = 1% of 1200 = 12.00 (within 10–750)
    eq(result.processingFee, '12.00')
    // VAT = (1200 + 540) × 0.10 + fee VAT 1.20 = 174 + 1.20
    eq(result.totalVat, '175.20')
    // Payable = 540 + 175.20 + 12
    eq(result.totalPayable, '727.20')
  })

  it('applies SPECIFIC duty by quantity — the alcohol case', () => {
    // e.g. spirits at $12.00 per litre: 48 × 0.75L bottles = 36 litres.
    const result = calculateShipment(
      [
        {
          id: 'rum',
          totalValue: '600.00',
          quantity: '36', // litres
          rates: {
            dutyBasis: 'SPECIFIC',
            dutyRate: '0',
            specificRate: '12.00',
            vatRate: '0.10',
            levyRate: '0',
            exciseRate: '0',
          },
        },
      ],
      { freightCharge: '100.00', insuranceCharge: '0', otherCharges: '0' },
    )
    // Duty = 36 × 12 = 432, regardless of CIF (700)
    eq(result.totalDuty, '432.00')
    // VAT = (700 + 432) × 0.10 = 113.20, plus fee VAT (fee=10 min → 1.00)
    eq(result.processingFee, '10.00') // 1% of 700 = 7 → clamped up to $10 minimum
    eq(result.totalVat, '114.20')
  })

  it('applies COMPOUND duty as the greater of ad valorem and specific', () => {
    const line = {
      id: 'x',
      totalValue: '1000.00',
      quantity: '5',
      rates: {
        dutyBasis: 'COMPOUND' as const,
        dutyRate: '0.10', // ad valorem on CIF 1000 → 100
        specificRate: '30.00', // 5 × 30 → 150 (greater — wins)
        vatRate: '0.10',
        levyRate: '0',
        exciseRate: '0',
      },
    }
    const result = calculateShipment([line], {
      freightCharge: '0',
      insuranceCharge: '0',
      otherCharges: '0',
    })
    eq(result.totalDuty, '150.00')
  })

  it('zeroes duty/levy/excise on FULL exemption but keeps VAT on CIF', () => {
    const result = calculateShipment(
      [
        {
          id: 'ex',
          totalValue: '500.00',
          quantity: '1',
          exemptionType: 'FULL',
          rates: { ...standardRates, levyRate: '0.05', exciseRate: '0.10' },
        },
      ],
      { freightCharge: '0', insuranceCharge: '0', otherCharges: '0' },
    )
    eq(result.totalDuty, '0.00')
    eq(result.totalLevy, '0.00')
    eq(result.totalExcise, '0.00')
    eq(result.totalVat, '51.00') // 500 × 0.10 + fee VAT (10 × 0.10)
  })

  it('caps the processing fee at $750', () => {
    const result = calculateShipment(
      [{ id: 'big', totalValue: '100000.00', quantity: '1', rates: standardRates }],
      { freightCharge: '0', insuranceCharge: '0', otherCharges: '0' },
    )
    eq(result.processingFee, '750.00') // 1% of 100k = 1000 → capped
  })

  it('line totals reconcile exactly with shipment totals', () => {
    const lines = [
      { id: 'a', totalValue: '333.33', quantity: '3', rates: standardRates },
      { id: 'b', totalValue: '666.67', quantity: '7', rates: { ...standardRates, dutyRate: '0.25' } },
      { id: 'c', totalValue: '123.45', quantity: '1', rates: { ...standardRates, exciseRate: '0.65' } },
    ]
    const result = calculateShipment(lines, {
      freightCharge: '250.10',
      insuranceCharge: '33.33',
      otherCharges: '7.77',
    })
    eq(toMoney(sum(result.lines.map((l) => l.cifValue))), result.totalCifValue.toFixed(2))
    eq(toMoney(sum(result.lines.map((l) => l.dutyAmount))), result.totalDuty.toFixed(2))
    // CIF total = FOB + all charges, to the penny.
    eq(result.totalCifValue, toMoney(sum(['333.33', '666.67', '123.45', '250.10', '33.33', '7.77'])).toFixed(2))
  })

  it('adds ad valorem and specific duty for beer', () => {
    const result = calculateShipment(
      [
        {
          id: 'beer',
          totalValue: '1000.00',
          quantity: '10',
          dutyAssessmentQuantity: '19.8',
          rates: {
            dutyBasis: 'ADDITIVE',
            dutyRate: '0.10',
            specificRate: '10.00',
            vatRate: '0.10',
            levyRate: '0',
            exciseRate: '0',
          },
        },
      ],
      { freightCharge: '0', insuranceCharge: '0', otherCharges: '0' },
    )
    // Beer: 10% of CIF (100.00) + 19.8 imperial gallons x $10 (198.00).
    eq(result.totalDuty, '298.00')
  })

  it('applies current spirits excise per imperial gallon', () => {
    const result = calculateShipment(
      [
        {
          id: 'rum',
          totalValue: '1000.00',
          quantity: '10',
          exciseAssessmentQuantity: '19.8',
          rates: {
            dutyBasis: 'AD_VALOREM',
            dutyRate: '0',
            vatRate: '0.10',
            levyRate: '0',
            exciseBasis: 'SPECIFIC',
            exciseRate: '0',
            exciseSpecificRate: '13.00',
          },
        },
      ],
      { freightCharge: '0', insuranceCharge: '0', otherCharges: '0' },
    )
    // Excise = 19.8 imperial gallons x $13 = 257.40.
    eq(result.totalExcise, '257.40')
    // Line VAT = (1000 + 257.40) x 10% = 125.74; fee VAT = 1.00.
    eq(result.totalVat, '126.74')
  })

  it('converts invoice currency to BSD before CIF and duty', () => {
    const result = calculateShipment(
      [
        {
          id: 'usd-line',
          totalValue: '100.00',
          exchangeRate: '1.50000000',
          quantity: '1',
          rates: {
            dutyBasis: 'AD_VALOREM',
            dutyRate: '0.10',
            vatRate: '0.10',
            levyRate: '0',
            exciseRate: '0',
          },
        },
      ],
      { freightCharge: '0', insuranceCharge: '0', otherCharges: '0' },
    )
    // FOB BSD = 100.00 x 1.5 = 150.00; duty = 15.00.
    eq(result.totalFobValue, '150.00')
    eq(result.totalDuty, '15.00')
  })
})

describe('alcohol assessment quantities', () => {
  it('converts cases and ABV using the Customs training factors', () => {
    const result = calculateAlcoholQuantities({
      packageQuantity: '10',
      unitsPerPackage: '12',
      unitVolume: '750',
      volumeUnit: 'ML',
      alcoholStrength: '40',
      alcoholStrengthBasis: 'ABV_PERCENT',
    })

    // 10 x 12 x 750ml = 90L; Customs deck: 90 x 0.22 = 19.8 imperial gallons.
    expect(result.totalLitres.toFixed(3)).toBe('90.000')
    expect(result.imperialGallons.toFixed(3)).toBe('19.800')
    // British proof factor = (40 x 1.75) / 100 = 0.70; 19.8 x 0.70 = 13.86.
    expect(result.proofGallons?.toFixed(3)).toBe('13.860')
  })

  it('converts a bulk litre declaration directly to imperial gallons', () => {
    const result = resolveSpecificQuantity('IMP_GAL', {
      lineQuantity: '600',
      lineUnit: 'L',
    })
    expect(result.toFixed(2)).toBe('132.00')
  })
})
