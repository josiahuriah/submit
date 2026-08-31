'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { declarationArtifactsService } from '@/server/services/declaration-artifacts.service'
import { AppError } from '@/lib/errors'

export interface GenerateReviewXmlResult {
  batchId: string | null
  artifacts: { id: string; groupCode: string; downloadUrl: string; fileName: string }[]
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
    const issues = result.artifacts.flatMap((artifact) => artifact.validation.issues)
    const warnings = issues
      .filter((issue) => issue.severity === 'WARNING')
      .map((issue) => `${issue.field}: ${issue.message}`)
    return {
      batchId: result.batchId,
      artifacts: result.artifacts.map((artifact) => ({
        id: artifact.artifact.id,
        groupCode: artifact.artifact.declarationGroupCode,
        downloadUrl: artifact.downloadUrl,
        fileName: artifact.fileName,
      })),
      warnings,
      issues,
      error: null,
    }
  } catch (error) {
    if (error instanceof AppError) {
      const details = error.details as { issues?: GenerateReviewXmlResult['issues'] } | undefined
      return {
        batchId: null,
        artifacts: [],
        warnings: [],
        issues: details?.issues ?? [],
        error: error.message,
      }
    }
    throw error
  }
}
