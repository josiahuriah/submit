import 'dotenv/config'
import { defineConfig } from 'prisma/config'

/**
 * Prisma 7 reads the datasource URL from here (the CLI no longer takes it
 * from the schema's datasource block). Migrations and `db push` must use the
 * UNPOOLED connection — PgBouncer transaction pooling breaks the schema
 * engine's advisory locks — so DIRECT_URL wins when set. The app runtime is
 * unaffected: it builds its own pooled client via the pg driver adapter in
 * src/lib/db/prisma.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
    /**
     * Scratch database the migration engine builds a clean schema in to work
     * out a diff. Required by `migrate dev` and `migrate diff --from-migrations`.
     * It is created, used and dropped by Prisma — never point it at a database
     * holding real data.
     */
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL || undefined,
  },
})
