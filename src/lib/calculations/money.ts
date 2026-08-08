/**
 * Money primitives. Everything financial flows through Decimal — floats are
 * banned from this codebase for money (0.1 + 0.2 !== 0.3 is not a rounding
 * error customs will forgive).
 *
 * Customs assessment outputs are BSD. Invoice-currency FOB is converted with
 * the invoice's frozen BSD exchange rate before apportionment and taxation.
 */
import Decimal from 'decimal.js'

// Customs convention: round half up, 2 decimal places for money.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

export type DecimalInput = Decimal.Value

export const ZERO = new Decimal(0)

export function d(value: DecimalInput | null | undefined): Decimal {
  if (value === null || value === undefined) return ZERO
  return new Decimal(value)
}

/** Round to cents (2dp, half-up). */
export function toMoney(value: DecimalInput): Decimal {
  return d(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

/** Serialize for API responses / Prisma writes. */
export function moneyString(value: DecimalInput): string {
  return toMoney(value).toFixed(2)
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), ZERO)
}

/** value clamped to [min, max]. */
export function clamp(value: Decimal, min: Decimal, max: Decimal): Decimal {
  if (value.lessThan(min)) return min
  if (value.greaterThan(max)) return max
  return value
}
