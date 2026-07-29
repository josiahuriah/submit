import { describe, expect, it } from 'vitest'
import {
  assertDutyColumnsAgree,
  cleanDescription,
  normalizeCode,
  normalizeTariffEntry,
  normalizeTariffFile,
  type RawTariffRecord,
} from '../prisma/tariff-import'

/**
 * The tariff extraction is re-imported whenever rates change (yearly). These
 * tests pin the transform decisions so a future import cannot silently
 * reintroduce the failure modes found in the 2023 file.
 */

function raw(over: Partial<RawTariffRecord> = {}): RawTariffRecord {
  return {
    code: '0201.1000',
    description: 'Carcasses and half carcasses',
    chapter: '02',
    heading: '0201',
    subheading: '0201.10',
    unit: 'pound',
    sectionNumber: 'I',
    sectionName: 'Live Animals; Animal Products',
    chapterName: 'Meat and Edible Meat Offal',
    dutyRate: '0.0000',
    generalRate: 'Free',
    specificRate: 'None',
    maxVariableRate: null,
    preferentialRate: 'EPA',
    ...over,
  }
}

describe('normalizeCode', () => {
  it('reformats xxxx.dddd to the xxxx.dd.dd form BEAIP accepts', () => {
    expect(normalizeCode('0201.1000')).toBe('0201.10.00')
    expect(normalizeCode('2208.3000')).toBe('2208.30.00')
  })

  it('produces codes that satisfy the BEAIP submission validator', () => {
    const beaip = /^\d{4}\.\d{2}(\.\d{2})?$/
    expect(beaip.test(normalizeCode('8703.2310'))).toBe(true)
    // The raw form is exactly what BEAIP rejects — the reason this exists.
    expect(beaip.test('8703.2310')).toBe(false)
  })

  it('refuses an unrecognized code shape rather than guessing', () => {
    expect(() => normalizeCode('87.03')).toThrow(/not in the expected/)
  })
})

describe('cleanDescription', () => {
  it('strips ** footnote markers and --- indent dashes', () => {
    expect(cleanDescription('** --- Brandy, in bottles')).toBe('Brandy, in bottles')
    expect(cleanDescription('** - Vodka')).toBe('Vodka')
  })
})

describe('assertDutyColumnsAgree', () => {
  it('accepts the decimal and human columns when they match', () => {
    expect(() => assertDutyColumnsAgree(raw({ dutyRate: '0.4500', generalRate: '45%' }))).not.toThrow()
    expect(() => assertDutyColumnsAgree(raw({ dutyRate: '0.0000', generalRate: 'Free' }))).not.toThrow()
  })

  it('halts the import when a future extraction misparses a rate', () => {
    expect(() => assertDutyColumnsAgree(raw({ dutyRate: '0.4500', generalRate: '20%' }))).toThrow(
      /duty columns disagree/,
    )
  })
})

describe('normalizeTariffEntry', () => {
  it('discards the bogus specificRate column instead of mapping it', () => {
    // '300%' appears on 169 duty-free food lines. As a specific rate it would
    // mean $300 per pound of beef.
    const entry = normalizeTariffEntry(raw({ specificRate: '300%' }))
    expect(entry.rate).toEqual({ dutyBasis: 'AD_VALOREM', dutyRate: '0.0000' })
    expect(entry.rate).not.toHaveProperty('specificRate')
  })

  it('carries duty, unit and section metadata through', () => {
    const entry = normalizeTariffEntry(raw({ dutyRate: '0.4500', generalRate: '45%' }))
    expect(entry.code).toBe('0201.10.00')
    expect(entry.rate.dutyRate).toBe('0.4500')
    expect(entry.unit).toBe('LB')
    expect(entry.sectionNumber).toBe('I')
  })
})

describe('normalizeTariffFile', () => {
  it('never overwrites a curated line', () => {
    // 2208.6000 -> 2208.60.00 is vodka: curated as SPECIFIC $12.00/L, but the
    // extraction claims duty 0. Importing it would zero the duty on spirits.
    const records = [raw({ code: '2208.6000', dutyRate: '0.0000', generalRate: 'Free' })]
    const report = normalizeTariffFile(records, (code) => code === '2208.60.00')

    expect(report.imported).toHaveLength(0)
    expect(report.skippedCurated).toEqual(['2208.60.00'])
  })

  it('counts imported codes in chapters whose excise data is missing', () => {
    const records = [
      raw({ code: '2208.9090', dutyRate: '0.0000', generalRate: 'Free' }),
      raw({ code: '0201.1000' }),
    ]
    const report = normalizeTariffFile(records, () => false)

    expect(report.imported).toHaveLength(2)
    expect(report.excisableGaps).toEqual({ '22': 1 })
  })
})
