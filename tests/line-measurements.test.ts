import { resolveSpecificQuantity } from '../src/lib/calculations/measurement'
import { describe, expect, it } from 'vitest'
import mappings from '../src/lib/customs/data/tariff-uoms.json'
import raw from '../prisma/data/hs-codes.json'
import { CUSTOMS_UOMS } from '../src/lib/customs/reference-data'
import { isTariffDisabled, tariffUom, requireTariffUom } from '../src/lib/customs/tariff-uoms'
import { allocateLineWeights } from '../src/lib/calculations/line-weights'
import { d } from '../src/lib/calculations/money'

describe('reviewed tariff UOMs', () => {
  it('accounts for every shipped tariff and only uses Customs units', () => {
    expect(Object.keys(mappings).sort()).toEqual(raw.map(r => r.code.replace('.', '')).sort())
    for (const row of Object.values(mappings)) {
      if (row.unit) expect(CUSTOMS_UOMS.some(u => u.code === row.unit)).toBe(true)
      expect(row.pdfPage).toBeGreaterThan(0)
    }
    expect(Object.values(mappings).filter(r => r.unit === null)).toHaveLength(42)
  })
  it('disables every Chapter 98 code and resolves every other listed code', () => {
    for (const code of Object.keys(mappings)) {
      if (code.startsWith('98')) {
        expect(isTariffDisabled(code)).toBe(true)
        expect(() => requireTariffUom(code)).toThrow('disabled')
      } else {
        expect(requireTariffUom(code)).toBeTruthy()
      }
    }
    expect(isTariffDisabled('9801.0010')).toBe(true)
  })
  it('fixes extraction omissions without guessing blank source fields', () => {
    expect(tariffUom('7301.1000')).toBe('CWA')
    expect(tariffUom('4412.3100')).toBe('FTQ')
    expect(tariffUom('6807.9010')).toBe('T8')
    expect(tariffUom('8702.1020')).toBe('EA')
    expect(requireTariffUom('94012010')).toBe('EA')
    expect(() => requireTariffUom('98010010')).toThrow('Chapter 98 tariff codes are disabled')
    expect(() => requireTariffUom('99999999')).toThrow('no confirmed UOM')
  })
})
describe('line weight allocation', () => {
  const lines = [1, 2, 3].map(id => ({ id: String(id), totalValue: '1' }))
  it('distributes remainder pounds exactly and deterministically', () => {
    expect(allocateLineWeights('1', lines).map(r => r.weightLb)).toEqual(['0.334', '0.333', '0.333'])
    for (const total of ['0.001', '7.829', '999999999.999']) {
      const result = allocateLineWeights(total, lines)
      expect(result.reduce((sum, r) => sum.plus(r.weightLb), d(0)).toFixed(3)).toBe(total)
    }
  })
  it('uses values, reallocates after deletion, and splits zero-value shipments equally', () => {
    const unequal = [{ id: 'a', totalValue: '25' }, { id: 'b', totalValue: '75' }]
    expect(allocateLineWeights('100', unequal).map(r => r.weightLb)).toEqual(['25.000', '75.000'])
    expect(allocateLineWeights('100', unequal.slice(1))[0].weightLb).toBe('100.000')
    expect(allocateLineWeights('1', lines.map(l => ({ ...l, totalValue: '0' }))).map(r => r.weightLb)).toEqual(['0.334', '0.333', '0.333'])
  })
  it('rejects missing gross weight and allows an explicitly zero net weight', () => {
    expect(() => allocateLineWeights('0', lines)).toThrow()
    expect(() => allocateLineWeights('-1', lines)).toThrow()
    expect(allocateLineWeights('0', lines, true).every(r => r.weightLb === '0.000')).toBe(true)
  })
})

it('converts assigned proof-gallon quantities to historical rate units', () => {
  const input = { lineQuantity: '1.75', lineUnit: 'PGL', alcoholStrength: '100', alcoholStrengthBasis: 'ABV_PERCENT' as const }
  expect(resolveSpecificQuantity('IMP_GAL', input).toString()).toBe('1')
  expect(resolveSpecificQuantity('L', input).toFixed(6)).toBe('4.545455')
  expect(() => resolveSpecificQuantity('L', { ...input, alcoholStrength: '0' })).toThrow()
})
