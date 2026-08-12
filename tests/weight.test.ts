import { describe, expect, it } from 'vitest'
import { kilogramsToPounds, poundsToKilograms } from '@/lib/units/weight'

describe('broker-facing weight conversion', () => {
  it('converts pounds to the three-decimal KGM precision stored by Prisma', () => {
    expect(poundsToKilograms('100')).toBe('45.359')
    expect(poundsToKilograms('2.205')).toBe('1.000')
  })

  it('converts stored kilograms back to pounds for editing', () => {
    expect(kilogramsToPounds('45.359')).toBe('99.999')
    expect(kilogramsToPounds(null)).toBe('')
  })

  it('preserves an empty optional input', () => {
    expect(poundsToKilograms('  ')).toBe('')
  })
})
