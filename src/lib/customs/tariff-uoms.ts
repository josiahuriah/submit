import mappings from './data/tariff-uoms.json'
import { BusinessRuleError } from '@/lib/errors'

const rows: Record<string, { unit: string | null; sourceUnit: string | null; pdfPage: number }> = mappings

export function isTariffDisabled(code: string): boolean {
  return code.replace(/\D/g, '').startsWith('98')
}

/** Source-backed units plus explicitly approved overrides. */
export function tariffUom(code: string): string | null {
  if (isTariffDisabled(code)) return null
  return rows[code.replace(/\D/g, '')]?.unit ?? null
}

export function requireTariffUom(code: string): string {
  if (isTariffDisabled(code)) throw new BusinessRuleError('Chapter 98 tariff codes are disabled.')
  const unit = tariffUom(code)
  if (!unit) throw new BusinessRuleError(`Tariff ${code} has no confirmed UOM in the supplied schedule. A reference-data update is required.`)
  return unit
}
