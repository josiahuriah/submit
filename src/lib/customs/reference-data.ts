/** Customs reference lists supplied 2026-09-16; preserve alphanumeric codes verbatim. */
import cpcs from './data/cpc-codes.json'
import ports from './data/customs-ports.json'
import uoms from './data/uoms.json'

export const CPC_CODES = [...new Map(cpcs.filter((row) => row.active).map((row) => [`${row.groupCode}:${row.code}`, row])).values()]
export const CUSTOMS_PORTS = ports.filter((row) => row.active)
export const CUSTOMS_UOMS = uoms.filter((row) => row.active)
const cpcByCode = new Map(cpcs.filter((row) => row.active).map((row) => [row.code, row]))
const portCodes = new Set(CUSTOMS_PORTS.map((row) => row.code))
const uomCodes = new Set(CUSTOMS_UOMS.map((row) => row.code))

export const CPC_GROUPS = [...new Set(CPC_CODES.map((row) => row.groupCode))].sort().map((code) => ({
  code,
  // The supplied list has item descriptions, not a separate group-name master.
  description: code === '400' ? 'Import for home consumption'
    : code === '4098' ? 'Duty concession for imported goods'
    : cpcs.filter((row) => row.groupCode === code).length === 1
      ? cpcs.find((row) => row.groupCode === code)!.description
      : `CPC group ${code}`,
}))
const groupCodes = new Set(CPC_GROUPS.map((row) => row.code))
export const isCpcGroup = (code: string) => groupCodes.has(code)
export const isCpcCode = (code: string) => cpcByCode.has(code)
export const cpcGroupFor = (code: string) => {
  const groups = [...new Set(cpcs.filter((row) => row.code === code).map((row) => row.groupCode))]
  return groups.length === 1 ? groups[0] : undefined
}
export const cpcsForGroup = (group: string) => CPC_CODES.filter((row) => row.groupCode === group)
export const isCpcInGroup = (code: string, group: string) => CPC_CODES.some((row) => row.code === code && row.groupCode === group)
export const isCustomsPort = (code: string) => portCodes.has(code)
export const isCustomsUom = (code: string) => uomCodes.has(code)
export const customsPortLabel = (code: string | null | undefined) => {
  const port = ports.find((row) => row.code === code)
  return port ? `${port.code} — ${port.description}` : 'Select a Customs port'
}
