/** Canonical Submit values used by data entry, calculation, and XML export. */
export const BSD_CURRENCY = 'BSD' as const
export const STANDARD_IMPORT_CPC = '400' as const
export const CONCESSION_IMPORT_CPC = '4098' as const
export const IMPORT_CPCS = [STANDARD_IMPORT_CPC, CONCESSION_IMPORT_CPC] as const

/** Keep HS codes as strings so leading zeroes are never lost. */
export function normalizeHsCode(value: string): string {
  return value.replace(/\D/g, '')
}

export function isEightDigitHsCode(value: string): boolean {
  return /^\d{8}$/.test(normalizeHsCode(value))
}

export function normalizeImportCpc(value: string): string {
  return value.replace(/\D/g, '')
}
