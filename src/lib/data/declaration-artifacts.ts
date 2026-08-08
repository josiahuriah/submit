'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { declarationArtifactsService } from '@/server/services/declaration-artifacts.service'
import { AppError } from '@/lib/errors'

export interface GenerateReviewXmlResult {
  downloadUrl: string | null
  fileName: string | null
  warnings: string[]
  issues: { severity: 'BLOCKER' | 'WARNING'; field: string; message: string }[]
  error: string | null
}

export async function generateReviewXml(
  shipmentId: string,
  declarationType: 'C13' | 'C14' | 'C17' | 'C18' | 'OTHER' = 'C13',
): Promise<GenerateReviewXmlResult> {
  try {
    const claims = await requireSession()
    requirePermission(claims.role, 'shipments:write')
    const headerList = await headers()
    const result = await declarationArtifactsService.generate(
      createTenantClient(claims.orgId),
      {
        userId: claims.sub,
        ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: headerList.get('user-agent') ?? undefined,
      },
      shipmentId,
      { declarationType },
    )
    const warnings = result.validation.issues
      .filter((issue) => issue.severity === 'WARNING')
      .map((issue) => `${issue.field}: ${issue.message}`)
    return {
      downloadUrl: result.downloadUrl,
      fileName: result.fileName,
      warnings,
      issues: result.validation.issues,
      error: null,
    }
  } catch (error) {
    if (error instanceof AppError) {
      const details = error.details as { issues?: GenerateReviewXmlResult['issues'] } | undefined
      return {
        downloadUrl: null,
        fileName: null,
        warnings: [],
        issues: details?.issues ?? [],
        error: error.message,
      }
    }
    throw error
  }
}
