'use server'

import { requireSession } from '@/lib/auth/session'
import { createTenantClient } from '@/lib/db/tenant-client'
import { NotFoundError } from '@/lib/errors'
import { TFP_COMPANY_REGISTRATION_NUMBER } from '@/lib/beaip/constants'
import { kilogramsToPounds } from '@/lib/units/weight'
import type { DeclarationProfile } from '@/lib/types'

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export async function getDeclarationProfile(shipmentId: string): Promise<DeclarationProfile> {
  const claims = await requireSession()
  const db = createTenantClient(claims.orgId)
  const shipment = await db.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      submittedAt: true,
      regimeCode: true,
      goodsLocationCode: true,
      warehouseCode: true,
      transportNationalityCode: true,
      transportMode: true,
      blNumber: true,
      containerNumber: true,
      containerSealNumber: true,
      containerFullnessCode: true,
      packageCount: true,
      packageType: true,
      grossWeightKg: true,
      netWeightKg: true,
    },
  })
  if (!shipment) throw new NotFoundError('Shipment')

  return {
    companyRegistrationNumber: TFP_COMPANY_REGISTRATION_NUMBER,
    declarationDate: shipment.submittedAt?.toISOString().slice(0, 10) ?? '',
    declarationFunctionCode: '9',
    regimeCode: shipment.regimeCode,
    goodsLocationCode: text(shipment.goodsLocationCode),
    warehouseCode: text(shipment.warehouseCode),
    transportNationalityCode: text(shipment.transportNationalityCode),
    transportMode: shipment.transportMode as 'SEA' | 'AIR',
    blNumber: text(shipment.blNumber),
    containerNumber: text(shipment.containerNumber),
    containerSealNumber: text(shipment.containerSealNumber),
    containerFullnessCode: text(shipment.containerFullnessCode),
    packageCount: String(shipment.packageCount),
    packageType: shipment.packageType,
    grossWeightLb: kilogramsToPounds(shipment.grossWeightKg === null ? null : String(shipment.grossWeightKg)),
    netWeightLb: kilogramsToPounds(shipment.netWeightKg === null ? null : String(shipment.netWeightKg)),
  }
}
