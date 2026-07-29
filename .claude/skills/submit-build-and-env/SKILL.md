---
name: submit-build-and-env
description: >
  Recreate a working Submit dev environment from scratch and diagnose setup
  failures. Use when: setting up a new machine or fresh copy of the repo;
  npm run db:seed / db:seed:dev fails; tests fail with a database connection
  error or "Dev seed missing"; typecheck/tests fail on @/generated/prisma
  imports; RLS questions (does it work locally? why does superuser bypass it?);
  env var questions (which are required, defaults, JWT_SECRET length,
  BEAIP_MODE); smoke test or `npm run dev` won't start.
---

# Submit — Build & Environment Setup

Verified against the repo on 2026-07-08. The code is the contract: when this
document, the README, and the source disagree, `src/lib/env.ts` and
`package.json` win.

**When NOT to use this skill:**
- Changing the Prisma schema or writing migrations → `submit-schema-and-migrations`
- Deciding what evidence proves a change works → `submit-validation-and-qa`
- Layering rules (route/service/repository) → `submit-architecture-contract`
- Duty/VAT/levy math questions → `submit-calculations-and-money` and `bahamas-customs-reference`
- Auth, JWT, tenant-client internals → `submit-auth-and-tenancy`
- API shapes and route conventions → `submit-api-conventions`
- BEAIP SOAP/mock behavior → `submit-beaip-integration-campaign`
- Whether you are allowed to make a change at all → `submit-change-control`

## Prerequisites

- **Node.js 22.x** (repo pins `@types/node ^22.10.0`; no `engines` field in
  package.json). Next.js 15 needs ≥18.18, but match types: use 22.
- **PostgreSQL**: Neon (recommended — RLS actually enforces there) or local
  Postgres. Caveat: on local Postgres your role is usually a **superuser and
  silently bypasses RLS** (layer 3 absent; layers 1–2 still isolate). See traps.
- **npm** (repo uses package-lock.json). All scripts run TypeScript via
  **tsx** (not ts-node).

## First-time setup runbook

```bash
npm install                   # postinstall runs `prisma generate` automatically
cp .env.example .env          # EDIT IT — placeholders fail validation (see below)
npx prisma generate           # only needed if postinstall was skipped
npx prisma migrate deploy     # or: npx prisma db push (one migration exists: 20260707000000_init)
npm run db:rls                # tsx prisma/apply-rls.ts → applies sql/rls.sql then sql/rls.sql
npm run db:seed               # GLOBAL reference data — must run FIRST
npm run db:seed:dev           # dev tenants + demo shipment — depends on db:seed
npm run dev                   # http://localhost:3000
```

Shortcut after `npm install` + `.env` edit — `npm run db:setup` runs the whole
chain: `db:push && db:rls && db:seed && db:seed:dev`.

**Seed order matters.** `prisma/seed.dev.ts` does `findUniqueOrThrow` on
carrier `TROP`, ports `USPEF`/`BSNAS`, shipping agent `TSA-NAS`, customs
office `NAS`, and HS codes `2208.40.00`/`6109.10.00`/`8418.10.00` — all
created by `prisma/seed.ts`. Run dev seed before global seed and it throws.
Both seeds are idempotent (upserts) and safe to re-run.

`prisma/data/` is empty by default: the global seed falls back to the 43-code
`HS_SUBSET` in `prisma/seed.ts`. Drop the full extraction at
`prisma/data/hs-codes.json` (same shape) and re-seed to load all 1,544 codes.

## Environment variables (canonical: `src/lib/env.ts`)

Zod-validated, cached after first `env()` call, **fail-fast** — a bad value
crashes at boot, not mid-request.

| Key | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres connection string. Neon **pooled** (`-pooler`) in production. Used by the app, apply-rls.ts, seeds, and tests. |
| `DIRECT_URL` | no | — | Declared optional in env.ts and documented in .env.example ("for migrations"), but **nothing in the repo actually reads it** — schema.prisma has no `directUrl`. Harmless to leave placeholder. |
| `JWT_SECRET` | yes | — | env.ts enforces **min 16 chars**; README says ≥32. Code wins (16 is the hard floor); treat the README's 32 as the operational standard: `openssl rand -hex 32`. |
| `SESSION_TTL_SECONDS` | no | `43200` (12h) | Coerced positive int. |
| `BEAIP_MODE` | no | `mock` | `mock` or `production`. |
| `BEAIP_ENDPOINT` / `BEAIP_USERNAME` / `BEAIP_PASSWORD` / `BEAIP_BROKER_CODE` | no | `''` | **env.ts does NOT enforce these even when `BEAIP_MODE=production`** — see trap 7. |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production`. |

Never copy secret values into docs or chat. Refer to keys only.

## RLS step (`npm run db:rls`)

Runs `prisma/apply-rls.ts` (plain `pg` Client on `DATABASE_URL`), which applies
`prisma/sql/rls.sql` (pg_trgm extension + 6 GIN trigram indexes) then
`prisma/sql/rls.sql`. Idempotent — re-run freely.

`rls.sql` puts `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation`
policy (`organizationId = current_setting('app.current_org_id', true)`) on the
12 tenant tables, plus a parent-scoped policy on `BrokerageInvoiceItem`, a
self-scoped one on `Organization`, and `system_bypass` policies (User,
Organization, AuditLog) gated on `app.bypass_rls` for pre-auth flows.
`FORCE` matters because Neon's `neondb_owner` owns the tables and owners
bypass RLS without it. Settings are transaction-scoped (`set_config(..., true)`)
— required under PgBouncer transaction pooling.

**RLS only truly enforces on non-superuser roles** (Neon's `neondb_owner`).
Local superuser Postgres bypasses RLS entirely — the Prisma extension layer
(`src/lib/db/tenant-client.ts`) still isolates, and that is exactly what the
integration tests prove.

## Seeded credentials (from `prisma/seed.dev.ts` — all password `Password123!`)

Org 1 — Bahama Brokerage Co (`bahama-brokerage`):
- `owner@bahamabrokerage.test` (OWNER)
- `admin@bahamabrokerage.test` (ADMIN)
- `broker@bahamabrokerage.test` (BROKER — the only demo role that can submit)
- `clerk@bahamabrokerage.test` (CLERK)
- `viewer@bahamabrokerage.test` (VIEWER)

Org 2 — Island Customs Ltd (`island-customs`):
- `owner@islandcustoms.test` (OWNER)

Both orgs have a shipment numbered `SHP-2026-00001` on purpose (proves
scoping). Org 1's has 3 mixed-duty-basis line items (specific-rate rum,
ad-valorem t-shirts, excise/levy refrigerator) on invoice `INV-88231`.

**Demo flow:** log in as `broker@bahamabrokerage.test`, open `SHP-2026-00001`,
press **Calculate**, then **Submit** (mock BEAIP returns a `BS-YYYY-E######`
reference).

## Verification runbook

```bash
npm test                  # vitest run — 16 tests: 11 calculation + 5 tenant isolation
npx tsx scripts/smoke.ts  # end-to-end against the live DB
npm run typecheck         # tsc --noEmit (needs generated Prisma client — trap 2)
npm run lint              # next lint
```

- **npm test** — the 5 isolation tests hit the live `DATABASE_URL` database
  and require both seeds (they throw "Dev seed missing — run `npm run db:seed
  && npm run db:seed:dev` first" otherwise). Vitest config: `tests/setup.ts`
  loads `.env` via dotenv, node environment, 30s timeouts, `@` → `src`.
- **smoke.ts** success looks like: resets SHP-2026-00001 to DRAFT and deletes
  its CustomsEntry rows, calculates (prints totals table), asserts rum duty
  `6000.00` (600 L × $10/L specific) and CIF−FOB apportionment exactly
  `2315.00`, submits via mock BEAIP, asserts status SUBMITTED, resets back to
  DRAFT, prints `✓ Smoke passed (shipment reset to DRAFT for demo use)`.
  Any thrown error exits non-zero.

## Known traps (symptom → cause → fix)

1. **File loss is unrecoverable.** There is **no `.git` directory** — this
   repo is not under version control. Symptom: none until it is too late.
   Fix: do not mass-edit or delete anything casually; flag `git init` to the
   owner as a Class A decision (see `submit-change-control`).

2. **`Cannot find module '@/generated/prisma/client'`** on typecheck/tests/
   seeds. Cause: the Prisma client is generated to `src/generated/prisma`
   (schema.prisma generator block; gitignored, tsconfig-excluded) and does not
   exist on a fresh copy — as of 2026-07-08 it is absent in this repo even
   though `node_modules` is present. Fix: `npx prisma generate` (also runs as
   npm postinstall). Nothing that touches Prisma works before this.

3. **Tests touch the LIVE database.** `tests/tenant-isolation.test.ts` runs
   against whatever `DATABASE_URL` points at: it reads the two seeded orgs,
   creates a `Client` row named `ISOLATION-TEST-CLIENT` (deleted in
   `afterAll`), and asserts on shipment counts. Safe on a dev DB; think twice
   before pointing `.env` at shared or production data. `scripts/smoke.ts` is
   more invasive: it deletes CustomsEntry rows for SHP-2026-00001 and rewrites
   its status.

4. **Leaked Neon credential.** Per the README, the Neon connection string used
   during development was shared in a chat session. Rotate the password in the
   Neon console before real client data touches that database. (As of
   2026-07-08 the checked `.env` here contains only placeholder values, but
   verify — and never print `.env` contents.)

5. **"RLS doesn't work locally."** On a local superuser Postgres, RLS is
   bypassed by design (superusers ignore policies). This is not a bug: layer 1
   (Prisma extension) still enforces isolation, which the 5 integration tests
   prove. Verify true RLS on Neon, where `neondb_owner` is not a superuser and
   FORCE RLS applies.

6. **`prisma/seed.dev.ts` is gitignored** (listed in `.gitignore`) yet
   **present in this copy** — because the repo has no git, ignore rules have
   never actually excluded it. Implication: the moment this becomes a git repo
   or is copied via git, `db:seed:dev` and `db:setup` break and the tests fail
   with "Dev seed missing". Keep a copy of the file, or revisit the ignore
   entry when git init happens.

7. **`BEAIP_MODE=production` with empty credentials boots cleanly.** env.ts
   defaults `BEAIP_ENDPOINT/USERNAME/PASSWORD/BROKER_CODE` to `''` and does
   NOT cross-validate against BEAIP_MODE. The failure is deferred:
   `ProductionBeaipClient`'s lazy `config` getter throws
   `BEAIP production mode requires BEAIP_ENDPOINT, BEAIP_USERNAME and
   BEAIP_PASSWORD` on the **first submission attempt**, not at startup. Check
   creds before flipping the mode; README says keep `BEAIP_MODE=mock` on
   Vercel for now.

8. **Fresh `.env` copied from `.env.example` fails at boot.** The example's
   `JWT_SECRET="change-me"` is 9 chars, below env.ts's 16-char minimum — zod
   throws `JWT_SECRET must be at least 16 characters` on first `env()` call,
   and `DATABASE_URL` is a `USER:PASSWORD@HOST` placeholder. Edit both before
   anything will run.

## Provenance and maintenance

Date-stamped 2026-07-08. Re-verify each section by reading, not trusting:
- Scripts/toolchain: `package.json` (scripts block; tsx everywhere; postinstall).
- Env contract: `src/lib/env.ts` (schema, defaults, min lengths).
- Client output path: `generator client` block in `prisma/schema.prisma`.
- RLS behavior: `prisma/apply-rls.ts`, `prisma/sql/rls.sql`, `prisma/sql/rls.sql`.
- Seed dependencies/credentials: `prisma/seed.ts`, `prisma/seed.dev.ts`.
- Test requirements: `vitest.config.ts`, `tests/setup.ts`, `tests/tenant-isolation.test.ts`.
- Smoke expectations: `scripts/smoke.ts`.
- Git status: `ls -a` at repo root (no `.git` as of stamp date).
