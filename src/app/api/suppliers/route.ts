import { withAuth } from '@/lib/auth/with-auth'
import { catalogService } from '@/server/services/catalog.service'
import { supplierCreateSchema, paginationQuery } from '@/lib/validation/schemas'
import { z } from 'zod'
import { ok, created } from '@/lib/api-response'

const listQuery = paginationQuery.extend({ search: z.string().max(120).optional() })

export const GET = withAuth(async (req, { db }) => {
  const query = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams))
  const page = await catalogService.listSuppliers(db, query)
  return ok(page.items, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } })
}, { permission: 'clients:read' })

export const POST = withAuth(async (req, { db, audit }) => {
  const input = supplierCreateSchema.parse(await req.json())
  return created(await catalogService.createSupplier(db, audit, input))
}, { permission: 'clients:write' })
