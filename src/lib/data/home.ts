import { requireSession } from '@/lib/auth/session'
import { createTenantClient } from '@/lib/db/tenant-client'
import { dashboardService } from '@/server/services/dashboard.service'

export async function getHomeDashboard() {
  const claims = await requireSession()
  return dashboardService.get(createTenantClient(claims.orgId))
}
