/**
 * createTenantClient(organizationId) — the PRIMARY tenant-isolation layer.
 *
 * Defense in depth, layer by layer:
 *   1. (this file)  Every query on a tenant-scoped model gets
 *      `organizationId` injected into its `where` / `data` automatically.
 *      Application code physically cannot forget the tenant filter.
 *   2. (with-auth)  A scoped client is created per request from JWT claims —
 *      the orgId comes from the verified token, never from user input.
 *   3. (rls.sql)    Every operation runs in a batch transaction whose first
 *      statement sets `app.current_org_id` via `set_config(..., true)`
 *      (transaction-scoped, PgBouncer-safe), so Postgres RLS backstops any
 *      bug in layers 1–2. Batch form guarantees the set_config and the query
 *      share one connection.
 *
 * Global lookup models (HSCode, Port, CustomsOffice, Carrier, Vessel,
 * Voyage, Journey, ShippingAgent, HSCodeRate) are intentionally NOT scoped —
 * they are shared reference data.
 */
import { basePrisma } from './prisma'

/** Models that carry an organizationId column and must always be scoped. */
const TENANT_MODELS = new Set<string>([
  'User',
  'Client',
  'Supplier',
  'Manifest',
  'Shipment',
  'ShipmentDocument',
  'Invoice',
  'LineItem',
  'CustomsEntry',
  'BrokerageInvoice',
  'Payment',
  'AuditLog',
])

/**
 * Operations whose `where` must be constrained to the tenant.
 * Note: since Prisma 5, findUnique accepts non-unique fields alongside the
 * unique selector, so it can be injected like everything else.
 */
const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

/** Operations whose `data` must be stamped with the tenant. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert'])

type AnyArgs = Record<string, unknown> & {
  where?: Record<string, unknown>
  data?: Record<string, unknown> | Record<string, unknown>[]
  create?: Record<string, unknown>
}

function injectWhere(args: AnyArgs, organizationId: string): AnyArgs {
  return { ...args, where: { ...(args.where ?? {}), organizationId } }
}

function stampData(args: AnyArgs, organizationId: string): AnyArgs {
  const stamp = (d: Record<string, unknown>) => ({ ...d, organizationId })
  const next: AnyArgs = { ...args }
  if (Array.isArray(args.data)) next.data = args.data.map(stamp)
  else if (args.data) next.data = stamp(args.data)
  if (args.create) next.create = stamp(args.create)
  return next
}

/**
 * Build a Prisma client permanently scoped to one organization.
 * Create one per request (cheap — extensions share the underlying pool).
 */
export function createTenantClient(organizationId: string) {
  if (!organizationId) throw new Error('createTenantClient requires an organizationId')

  return basePrisma.$extends({
    name: `tenant:${organizationId}`,
    client: {
      /** The organization this client is scoped to (read-only diagnostic). */
      $organizationId: organizationId,
      /**
       * Atomic multi-statement work. Opens ONE interactive transaction, sets
       * the RLS variable, then hands you a raw tx client. Inside the tx, RLS
       * is the enforcement layer (writes by id fetched from scoped reads are
       * safe); use for cases where several writes must commit together —
       * the per-operation extension wrapping cannot span statements.
       */
      async $tenantTransaction<T>(
        fn: (tx: Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0]) => Promise<T>,
      ): Promise<T> {
        return basePrisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`
          return fn(tx)
        })
      },
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          let nextArgs = args as AnyArgs

          if (model && TENANT_MODELS.has(model)) {
            if (WHERE_OPERATIONS.has(operation)) {
              nextArgs = injectWhere(nextArgs, organizationId)
            }
            if (CREATE_OPERATIONS.has(operation)) {
              nextArgs = stampData(nextArgs, organizationId)
              if (operation === 'upsert') {
                nextArgs = injectWhere(nextArgs, organizationId)
              }
            }
          }

          // Layer 3 (RLS): batch transaction — set_config and the query are
          // guaranteed to run on the same pooled connection, and the setting
          // expires with the transaction (safe under PgBouncer).
          const [, result] = await basePrisma.$transaction([
            basePrisma.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`,
            query(nextArgs as never) as never,
          ])
          return result
        },
      },
    },
  })
}

export type TenantClient = ReturnType<typeof createTenantClient>
