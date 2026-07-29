/**
 * Role-based access control.
 * Roles are ordered; a permission check passes when the user's role is at or
 * above the required level (a CLERK can enter data but not submit
 * declarations — only licensed BROKERs file).
 */
import { ForbiddenError } from '@/lib/errors'
import type { UserRole } from '@/generated/prisma/enums'

const ROLE_LEVEL: Record<UserRole, number> = {
  VIEWER: 0,
  CLERK: 1,
  BROKER: 2,
  ADMIN: 3,
  OWNER: 4,
}

export type Permission =
  | 'shipments:read'
  | 'shipments:write'
  | 'shipments:submit'
  | 'billing:read'
  | 'billing:write'
  | 'clients:read'
  | 'clients:write'
  | 'users:manage'
  | 'organization:manage'

const MINIMUM_ROLE: Record<Permission, UserRole> = {
  'shipments:read': 'VIEWER',
  'shipments:write': 'CLERK',
  'shipments:submit': 'BROKER',
  'billing:read': 'CLERK',
  'billing:write': 'BROKER',
  'clients:read': 'VIEWER',
  'clients:write': 'CLERK',
  'users:manage': 'ADMIN',
  'organization:manage': 'OWNER',
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[MINIMUM_ROLE[permission]]
}

export function requirePermission(role: UserRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(`Your role (${role}) cannot perform ${permission}`)
  }
}
