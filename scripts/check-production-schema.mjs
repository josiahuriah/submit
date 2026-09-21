/** Keep Vercel's current deployment serving until the required status-check schema is ready. */
import pg from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const migrations = [
  '20260917130000_sequential_declaration_reference',
  '20260921100000_submission_status_checks',
]

if (process.env.VERCEL_ENV === 'production') {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  })
  try {
    if (!process.env.DATABASE_URL) throw new Error('Missing database configuration')
    const requiredMigrations = migrations.map((migration) => ({
      migration,
      checksum: createHash('sha256').update(readFileSync(
        new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url),
      )).digest('hex'),
    }))
    await client.connect()
    const { rows } = await client.query(`
      SELECT
        NOT EXISTS (
          SELECT 1 FROM (VALUES ($1, $2), ($3, $4)) AS required(migration_name, checksum)
          WHERE NOT EXISTS (
            SELECT 1 FROM "_prisma_migrations" applied
            WHERE applied.migration_name = required.migration_name
              AND applied.checksum = required.checksum
              AND applied.finished_at IS NOT NULL
              AND applied.rolled_back_at IS NULL
          )
        ) AS migrated,
        (
          SELECT count(*) = 3 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND c.relname IN ('CustomsSubmissionBatch', 'CustomsSubmissionAttempt', 'CustomsSubmissionStatusCheck')
            AND c.relrowsecurity AND c.relforcerowsecurity
            AND EXISTS (
              SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation'
            )
        ) AS policies_ready
    `, requiredMigrations.flatMap(({ migration, checksum }) => [migration, checksum]))
    if (!rows[0]?.migrated || !rows[0]?.policies_ready) throw new Error('Schema is not ready')
    console.log('Production migration and tenant policies verified.')
  } catch {
    // Never print connection strings or database errors containing credentials.
    console.error(`Production build stopped: apply ${migrations.join(' and ')} with prisma migrate deploy, then npm run db:rls, before redeploying. No database changes were made by this check.`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
