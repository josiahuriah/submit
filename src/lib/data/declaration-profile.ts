'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { hasPermission, requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { declarationProfileUpdateSchema } from '@/lib/validation/schemas'
import { shipmentsService } from '@/server/services/shipments.service'
import { calculationsService } from '@/server/services/calculations.service'
import { writeAudit } from '@/lib/audit'
import { AppError, NotFoundError } from '@/lib/errors'
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
      declarationDate: true,
      declarationFunctionCode: true,
      regimeCode: true,
      goodsLocationCode: true,
      warehouseCode: true,
      transportNationalityCode: true,
      blNumber: true,
      containerNumber: true,
      containerSealNumber: true,
      containerFullnessCode: true,
      packageCount: true,
      packageType: true,
      grossWeightKg: true,
      netWeightKg: true,
      organization: { select: { companyRegistrationNumber: true } },
    },
  })
  if (!shipment) throw new NotFoundError('Shipment')
  return {
    companyRegistrationNumber: shipment.organization.companyRegistrationNumber ?? '',
    canManageOrganization: hasPermission(claims.role, 'organization:manage'),
    declarationDate: shipment.declarationDate.toISOString().slice(0, 10),
    declarationFunctionCode: shipment.declarationFunctionCode as '9' | '5' | '1',
    regimeCode: shipment.regimeCode,
    goodsLocationCode: text(shipment.goodsLocationCode),
    warehouseCode: text(shipment.warehouseCode),
    transportNationalityCode: text(shipment.transportNationalityCode),
    blNumber: text(shipment.blNumber),
    containerNumber: text(shipment.containerNumber),
    containerSealNumber: text(shipment.containerSealNumber),
    containerFullnessCode: text(shipment.containerFullnessCode),
    packageCount: String(shipment.packageCount),
    packageType: shipment.packageType,
    grossWeightKg: text(shipment.grossWeightKg),
    netWeightKg: text(shipment.netWeightKg),
  }
}

export interface UpdateDeclarationProfileResult {
  error: string | null
  calculationNotice: string | null
}

export async function updateDeclarationProfile(
  shipmentId: string,
  draft: Omit<DeclarationProfile, 'canManageOrganization'>,
): Promise<UpdateDeclarationProfileResult> {
  try {
    const claims = await requireSession()
    requirePermission(claims.role, 'shipments:write')
    const parsed = declarationProfileUpdateSchema.parse(draft)
    const db = createTenantClient(claims.orgId)
    const headerList = await headers()
    const audit = {
      userId: claims.sub,
      ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerList.get('user-agent') ?? undefined,
    }
    const existing = await db.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, calculatedAt: true },
    })
    if (!existing) throw new NotFoundError('Shipment')

    await shipmentsService.update(db, audit, shipmentId, {
      declarationDate: parsed.declarationDate,
      declarationFunctionCode: parsed.declarationFunctionCode,
      regimeCode: parsed.regimeCode,
      goodsLocationCode: parsed.goodsLocationCode || null,
      warehouseCode: parsed.warehouseCode || null,
      transportNationalityCode: parsed.transportNationalityCode || null,
      blNumber: parsed.blNumber || null,
      containerNumber: parsed.containerNumber || null,
      containerSealNumber: parsed.containerSealNumber || null,
      containerFullnessCode: parsed.containerFullnessCode || null,
      packageCount: parsed.packageCount,
      packageType: parsed.packageType,
      grossWeightKg: parsed.grossWeightKg || null,
      netWeightKg: parsed.netWeightKg || null,
    })

    if (hasPermission(claims.role, 'organization:manage')) {
      const before = await db.organization.findUnique({
        where: { id: claims.orgId },
        select: { companyRegistrationNumber: true },
      })
      await db.organization.update({
        where: { id: claims.orgId },
        data: { companyRegistrationNumber: parsed.companyRegistrationNumber || null },
      })
      if (before?.companyRegistrationNumber !== (parsed.companyRegistrationNumber || null)) {
        await writeAudit(db, audit, {
          action: 'UPDATE',
          entityType: 'OrganizationDeclarationIdentity',
          entityId: claims.orgId,
          changes: {
            before: { companyRegistrationNumber: before?.companyRegistrationNumber ?? null },
            after: { companyRegistrationNumber: parsed.companyRegistrationNumber || null },
          },
        })
      }
    }

    let calculationNotice: string | null = null
    if (existing.calculatedAt) {
      try {
        await calculationsService.calculate(db, audit, shipmentId, { apportionmentBasis: 'VALUE' })
      } catch (error) {
        calculationNotice = error instanceof Error
          ? `Profile saved; recalculate before XML generation: ${error.message}`
          : 'Profile saved; recalculate before XML generation.'
      }
    }
    return { error: null, calculationNotice }
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, calculationNotice: null }
    if (error && typeof error === 'object' && 'issues' in error) {
      return { error: 'Check the declaration profile fields.', calculationNotice: null }
    }
    throw error
  }
}
