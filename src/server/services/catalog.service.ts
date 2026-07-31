/**
 * Catalog service — clients, suppliers, manifests. CRUD with audit; these
 * entities carry no complex business rules, so a full repository layer would
 * be ceremony without benefit (the shipments repository remains the pattern
 * to copy when an entity grows real query complexity).
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import { cursorArgs, toPage, type PaginationParams } from '@/lib/db/pagination'
import { writeAudit, type AuditContext } from '@/lib/audit'
import { NotFoundError } from '@/lib/errors'

const CLIENT_SELECT = {
  id: true, name: true, clientType: true, tinNumber: true, email: true,
  phone: true, address: true, contactPerson: true, notes: true,
  isActive: true, createdAt: true,
} as const

const SUPPLIER_SELECT = {
  id: true, name: true, country: true, email: true, phone: true,
  address: true, isActive: true, createdAt: true,
} as const

const MANIFEST_SELECT = {
  id: true, manifestNumber: true, status: true, registeredAt: true, notes: true, createdAt: true,
  voyage: {
    select: {
      id: true, voyageNumber: true, arrivalDate: true,
      vessel: { select: { id: true, name: true, carrier: { select: { name: true } } } },
    },
  },
  shippingAgent: { select: { id: true, name: true } },
  _count: { select: { shipments: true } },
} as const

export const catalogService = {
  // --- clients ---------------------------------------------------------------
  async listClients(db: TenantClient, params: PaginationParams & { search?: string }) {
    const rows = await db.client.findMany({
      where: params.search
        ? { name: { contains: params.search, mode: 'insensitive' } } // pg_trgm-backed
        : undefined,
      select: CLIENT_SELECT,
      orderBy: { name: 'asc' },
      ...cursorArgs(params),
    })
    return toPage(rows, params)
  },

  async getClient(db: TenantClient, clientId: string) {
    const client = await db.client.findUnique({ where: { id: clientId }, select: CLIENT_SELECT })
    if (!client) throw new NotFoundError('Client')
    return client
  },

  async createClient(db: TenantClient, audit: AuditContext, data: Record<string, unknown>) {
    const client = await db.client.create({ data: data as never, select: CLIENT_SELECT })
    await writeAudit(db, audit, { action: 'CREATE', entityType: 'Client', entityId: client.id })
    return client
  },

  async updateClient(db: TenantClient, audit: AuditContext, clientId: string, data: Record<string, unknown>) {
    await this.getClient(db, clientId)
    const client = await db.client.update({ where: { id: clientId }, data: data as never, select: CLIENT_SELECT })
    await writeAudit(db, audit, { action: 'UPDATE', entityType: 'Client', entityId: clientId })
    return client
  },

  // --- suppliers --------------------------------------------------------------
  async listSuppliers(db: TenantClient, params: PaginationParams & { search?: string }) {
    const rows = await db.supplier.findMany({
      where: params.search ? { name: { contains: params.search, mode: 'insensitive' } } : undefined,
      select: SUPPLIER_SELECT,
      orderBy: { name: 'asc' },
      ...cursorArgs(params),
    })
    return toPage(rows, params)
  },

  async createSupplier(db: TenantClient, audit: AuditContext, data: Record<string, unknown>) {
    const supplier = await db.supplier.create({ data: data as never, select: SUPPLIER_SELECT })
    await writeAudit(db, audit, { action: 'CREATE', entityType: 'Supplier', entityId: supplier.id })
    return supplier
  },

  async updateSupplier(db: TenantClient, audit: AuditContext, supplierId: string, data: Record<string, unknown>) {
    const existing = await db.supplier.findUnique({ where: { id: supplierId }, select: { id: true } })
    if (!existing) throw new NotFoundError('Supplier')
    const supplier = await db.supplier.update({ where: { id: supplierId }, data: data as never, select: SUPPLIER_SELECT })
    await writeAudit(db, audit, { action: 'UPDATE', entityType: 'Supplier', entityId: supplierId })
    return supplier
  },

  // --- manifests --------------------------------------------------------------
  async listManifests(db: TenantClient, params: PaginationParams) {
    const rows = await db.manifest.findMany({
      select: MANIFEST_SELECT,
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(params),
    })
    return toPage(rows, params)
  },

  async getManifest(db: TenantClient, manifestId: string) {
    const manifest = await db.manifest.findUnique({ where: { id: manifestId }, select: MANIFEST_SELECT })
    if (!manifest) throw new NotFoundError('Manifest')
    return manifest
  },

  async createManifest(db: TenantClient, audit: AuditContext, data: Record<string, unknown>) {
    const manifest = await db.manifest.create({ data: data as never, select: MANIFEST_SELECT })
    await writeAudit(db, audit, { action: 'CREATE', entityType: 'Manifest', entityId: manifest.id })
    return manifest
  },

  async updateManifest(db: TenantClient, audit: AuditContext, manifestId: string, data: Record<string, unknown>) {
    await this.getManifest(db, manifestId)
    const manifest = await db.manifest.update({ where: { id: manifestId }, data: data as never, select: MANIFEST_SELECT })
    await writeAudit(db, audit, { action: 'UPDATE', entityType: 'Manifest', entityId: manifestId })
    return manifest
  },
}
