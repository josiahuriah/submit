import { withAuth } from '@/lib/auth/with-auth'
import { billingService } from '@/server/services/billing.service'
import { brokerageInvoiceCreateSchema, paginationQuery } from '@/lib/validation/schemas'
import { z } from 'zod'
import { ok, created } from '@/lib/api-response'

const listQuery = paginationQuery.extend({
  kind: z.enum(['INVOICE', 'QUOTE']).optional(),
  status: z.enum(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID']).optional(),
  clientId: z.string().optional(),
})

export const GET = withAuth(async (req, { db }) => {
  const query = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams))
  const page = await billingService.list(db, query)
  return ok(page.items, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } })
}, { permission: 'billing:read' })

export const POST = withAuth(async (req, { db, audit }) => {
  const input = brokerageInvoiceCreateSchema.parse(await req.json())
  return created(await billingService.create(db, audit, input))
}, { permission: 'billing:write' })
