import { isCpcGroup, isCpcInGroup, isCustomsPort, isCustomsUom } from '@/lib/customs/reference-data'
import { BusinessRuleError, NotFoundError } from '@/lib/errors'
import type { TenantClient } from '@/lib/db/tenant-client'

export function assertLineCustomsReferences(group: string | null, cpc: string, unit: string) {
  if (!group || !isCpcGroup(group)) throw new BusinessRuleError('Select a CPC group on the shipment before entering lines.')
  if (!isCpcInGroup(cpc, group)) throw new BusinessRuleError(`CPC ${cpc} is not available for shipment group ${group}. Select an appropriate line CPC.`)
  if (!isCustomsUom(unit)) throw new BusinessRuleError(`UOM ${unit} is not in the Customs list. Select a Customs UOM.`)
}

/** The linked manifest is authoritative; a shipment cannot override its port. */
export async function resolveShipmentCustomsPort(db: TenantClient, manifestId: string | null | undefined, standalonePort: string | null | undefined) {
  let code = standalonePort
  if (manifestId) {
    const manifest = await db.manifest.findUnique({ where: { id: manifestId }, select: { customsPortCode: true } })
    if (!manifest) throw new NotFoundError('Manifest')
    code = manifest.customsPortCode
  }
  if (!code || !isCustomsPort(code)) throw new BusinessRuleError(manifestId
    ? 'Select a Customs port on the manifest before using it for this shipment.'
    : 'Select a Customs port for this shipment.')
  return code
}
