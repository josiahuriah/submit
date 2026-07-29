/**
 * Prisma client singleton (Prisma 7, driver-adapter architecture).
 *
 * `basePrisma` connects through @prisma/adapter-pg, which works identically
 * against local Postgres (tests) and Neon's PgBouncer pooler (production).
 *
 * IMPORTANT — do not use `basePrisma` directly in request code:
 *   - Tenant-scoped work goes through createTenantClient() (tenant-client.ts)
 *   - Pre-auth work (login/registration) goes through systemQuery() below.
 * This file is the only place a raw, unscoped client exists.
 */
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '@/lib/env'

const globalForPrisma = globalThis as unknown as { basePrisma?: PrismaClient }

function buildClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL })
  return new PrismaClient({ adapter })
}

/** Unscoped client. Internal use only — see module docs. */
export const basePrisma: PrismaClient = globalForPrisma.basePrisma ?? buildClient()

// Prevent hot-reload connection leaks in development.
if (process.env.NODE_ENV !== 'production') globalForPrisma.basePrisma = basePrisma

/**
 * Run a set of operations with the RLS bypass flag set for the transaction.
 * Needed for flows that legitimately run before an org context exists:
 * login (find user by email), registration (create org + first user).
 *
 * Uses `set_config(..., true)` — TRANSACTION-scoped — which is the only safe
 * form under PgBouncer transaction pooling (Neon): session-level SET would
 * leak onto whichever request borrows the connection next.
 */
export async function systemQuery<T>(
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`
    return fn(tx)
  })
}
