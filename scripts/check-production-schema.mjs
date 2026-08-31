/** Keep Vercel's current deployment serving until the required schema is ready. */
import pg from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const migration = '20260830160000_beaip_uat_foundation'

if (process.env.VERCEL_ENV === 'production') {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
  try {
    if (!process.env.DATABASE_URL) throw new Error('Missing database configuration')
    const checksum = createHash('sha256').update(readFileSync(
      new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url),
    )).digest('hex')
    await client.connect()
    const { rows } = await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM "_prisma_migrations"
          WHERE migration_name = $1 AND checksum = $2
            AND finished_at IS NOT NULL AND rolled_back_at IS NULL
        ) AS migrated,
        (
          SELECT count(*) = 2 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND c.relname IN ('CustomsSubmissionBatch', 'CustomsSubmissionAttempt')
            AND c.relrowsecurity AND c.relforcerowsecurity
            AND EXISTS (
              SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
            )
        ) AS policies_ready
    `, [migration, checksum])
    if (!rows[0]?.migrated || !rows[0]?.policies_ready) throw new Error('Schema is not ready')
    console.log('Production migration and tenant policies verified.')
  } catch {
    // Never print connection strings or database errors containing credentials.
    console.error(`Production build stopped: apply ${migration} with prisma migrate deploy, then npm run db:rls, before redeploying. No database changes were made by this check.`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
