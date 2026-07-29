/**
 * Audit log helper. Called by services after state-changing operations.
 * Best-effort: an audit failure is logged but never fails the user's request.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import type { AuditAction } from '@/generated/prisma/enums'

export interface AuditContext {
  userId: string | null
  ip?: string
  userAgent?: string
}

export async function writeAudit(
  db: TenantClient,
  ctx: AuditContext,
  entry: {
    action: AuditAction
    entityType: string
    entityId?: string
    changes?: { before?: unknown; after?: unknown }
  },
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: ctx.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        changes: entry.changes ? JSON.parse(JSON.stringify(entry.changes)) : undefined,
        metadata: { ip: ctx.ip, userAgent: ctx.userAgent },
      } as never,
    })
  } catch (err) {
    console.error('[audit] failed to write audit log:', err)
  }
}
