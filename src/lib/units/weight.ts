import Decimal from 'decimal.js'

const KILOGRAMS_PER_POUND = new Decimal('0.45359237')

/**
 * Broker-facing forms use pounds. Customs and the persistence model use KGM,
 * so conversion happens once at the server-action boundary.
 */
export function poundsToKilograms(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return new Decimal(trimmed)
    .times(KILOGRAMS_PER_POUND)
    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
    .toFixed(3)
}

/** Convert stored KGM values for editing/display in broker-facing forms. */
export function kilogramsToPounds(value: string | number | null | undefined): string {
  if (value === null || value === undefined || String(value).trim() === '') return ''
  return new Decimal(String(value))
    .dividedBy(KILOGRAMS_PER_POUND)
    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
    .toFixed(3)
}
