/**
 * Applies the Row Level Security policies (tenant-isolation layer 3).
 * Run once after `prisma migrate deploy` / `prisma db push`:
 *   npm run db:rls
 * Idempotent — rls.sql uses DROP+CREATE throughout.
 *
 * RLS lives outside migrations because Prisma does not model policies, so it
 * cannot detect or recreate them. The pg_trgm GIN indexes used to live here
 * too; they are now declared in schema.prisma and created by migrations, which
 * is what stops `prisma migrate dev` reporting them as drift.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import 'dotenv/config'

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const file = 'rls.sql'
    const sql = readFileSync(path.join(__dirname, 'sql', file), 'utf8')
    console.log(`Applying ${file}...`)
    await client.query(sql)
    console.log(`  ✓ ${file}`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
