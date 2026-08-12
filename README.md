# Submit

Multi-tenant SaaS for Bahamian customs brokerages: prepare shipments, calculate
duty/VAT/levy/excise **to the cent**, generate TFP v1.4.4 XML for Customs review,
and bill clients — with hard tenant isolation between brokerage firms.

Direct Single Window submission is intentionally not implemented yet. The
government's current onboarding gate is a schema-reviewable XML file; endpoint,
authentication, envelope, and response semantics have not been released.

## Stack

Next.js 16.3 (App Router) · React 19.2 · TypeScript · Prisma 7 (driver adapter) ·
PostgreSQL (Neon) · Tailwind CSS v4 · Zod · decimal.js · Vitest

---

## Quick start (local)

Node.js 20.9 or newer is required; Node.js 22 LTS is recommended.

```bash
npm install
cp .env.example .env          # then edit values (see below)
npx prisma generate
npx prisma migrate deploy     # or: npx prisma db push
npm run db:rls                # applies pg_trgm indexes + Row Level Security
npm run db:seed               # global reference data (offices, ports, HS codes)
npm run db:seed:dev           # dev tenants + demo shipment (gitignored file)
npm run dev                   # http://localhost:3000
```

Log in with `broker@bahamabrokerage.test` / `Password123!`, calculate shipment
`SHP-2026-00001`, then use **Generate review XML**.

### Verifying everything

```bash
npm run lint                  # ESLint 9 + Next.js core-web-vitals rules
npm run typecheck             # strict TypeScript check
npm test                      # 45 tests, including fresh-account route-handler E2E
npx tsx scripts/smoke.ts      # calculate → verify math → generate XML; no endpoint call
npm run wco:generate          # TFP declaration XML from a calculated shipment + XSD validation
```

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection string in production |
| `JWT_SECRET` | yes | ≥32 random chars: `openssl rand -hex 32` |
| `SESSION_TTL_SECONDS` | no | default 43200 (12h) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | no | "Continue/Sign in with Google" on `/signup` and `/login`; unset = those buttons fail cleanly with an error message, password auth is unaffected |

> **Note on the Neon connection string used during development:** it was shared
> in a chat session while building this project. Rotate the password in the Neon
> console before real client data touches this database.

## Deploying to Neon + Vercel

1. Create the Neon project; copy the **pooled** connection string
   (`...-pooler...`) into `DATABASE_URL` on Vercel.
2. From your machine (direct or pooled both work for these):
   ```bash
   npx prisma migrate deploy
   npm run db:rls
   npm run db:seed
   ```
   Do **not** run `db:seed:dev` against production.
3. Set `JWT_SECRET` (fresh value) on Vercel. Deploy.
4. Optional — Google sign-in: create an OAuth client in Google Cloud Console,
   add `https://<your-domain>/api/auth/google/callback` as an authorized
   redirect URI, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
   `GOOGLE_REDIRECT_URI` (same callback URL) on Vercel.

RLS on Neon is real: `neondb_owner` is not a superuser and every tenant table
has `FORCE ROW LEVEL SECURITY`. (On a local superuser Postgres, RLS is bypassed
— the Prisma extension layer still enforces isolation, which is what the
integration tests prove.)

---

## Architecture

```
Route (validate: Zod)  →  Service (business rules, audit)  →  Repository / TenantClient (data)
```

### Tenant isolation — defense in depth

| Layer | Mechanism | File |
|---|---|---|
| 1 (primary) | Prisma client extension injects `organizationId` into every query/write on the 12 tenant-scoped models, including `findUnique` | `src/lib/db/tenant-client.ts` |
| 2 (request) | `withAuth()` builds a per-request tenant client from verified JWT claims — handlers never see an unscoped client | `src/lib/auth/with-auth.ts` |
| 3 (backstop) | Postgres RLS; every operation runs inside a transaction that does `set_config('app.current_org_id', $org, true)` — transaction-scoped, safe under PgBouncer transaction pooling | `prisma/sql/rls.sql` |

`db.$tenantTransaction(fn)` is the escape hatch for multi-write atomicity
(calculation persist, payment + balance update): one interactive transaction,
RLS variable set first.

Global reference data (HS codes, ports, customs offices, carriers) is **not**
tenant-scoped and is read through `basePrisma`.

### Calculation engine (`src/lib/calculations/`)

Pure, deterministic, unit-tested. decimal.js throughout — floats never touch money.

- **Apportionment** (`apportionment.ts`): largest-remainder method distributes
  freight/insurance/other across line items by VALUE or WEIGHT; per-line cents
  sum *exactly* to the shipment charge.
- **Duty and excise** (`duty-calculator.ts`): independent `AD_VALOREM`,
  `SPECIFIC`, `COMPOUND` (greater), and `ADDITIVE` (sum) bases. Beer can use
  ad-valorem plus per-imperial-gallon duty; spirits can use a separate specific
  excise basis. Alcohol assessment quantities use the supplied Customs
  litre/imperial-gallon/proof-gallon worksheet factors.
  Invoice FOB is converted to BSD before apportionment and taxation.
  VAT on (CIF + duty + excise + levy). Processing fee 1% of shipment CIF,
  clamped $10–$750, plus VAT on the fee.
- **Effective-dated rate freezing**: the declaration date selects the newest
  applicable rate version; rate, basis, unit, converted assessment quantity,
  and BSD FOB are copied onto each line for auditability.
- **Fail-safe excisable goods**: chapters 22, 24, 27, and 87 cannot calculate
  from an unverified duty-only extraction row.
- **Staleness guard**: any invoice/line-item mutation clears
  `shipment.calculatedAt`; review-artifact generation refuses until recalculated.

### TFP XML artifact workflow (`src/lib/beaip/`)

`declaration-mapper.ts` maps tenant-scoped shipment data into the internal TFP
contract. The executable preflight blocks missing mandatory data;
`wco-xml.ts` emits the namespaced declaration in XSD sequence order. Generation
stores the exact XML, mapping/schema versions, timestamp, and validation report
on a `CustomsEntry`, then exposes an authenticated download. It does **not**
advance shipment status or contact an endpoint.

The formal mapping and unresolved code-master dependencies are recorded in
`docs/tfp/field-mapping-matrix.md`. The previous hypothetical SOAP/ASYCUDA-style
client and mock submission path were removed; integration begins only after
Customs supplies step-4 endpoint documentation.

### RBAC

`VIEWER < CLERK < BROKER < ADMIN < OWNER`. The one domain-critical rule:
**`shipments:submit` is reserved for BROKER+** when a verified endpoint workflow
is introduced. Clerks can currently prepare declarations and generate review artifacts.

---

## API surface (29 routes)

```
POST   /api/auth/register|login|logout        GET /api/auth/me
GET    /api/auth/google?intent=login|signup    GET /api/auth/google/callback
GET|POST /api/shipments                       GET|PATCH|DELETE /api/shipments/:id
POST   /api/shipments/:id/status (DRAFT cancellation only)
POST   /api/shipments/:id/calculate|artifacts
GET    /api/shipments/:id/invoices
GET|POST /api/clients      GET|PATCH /api/clients/:id
GET|POST /api/suppliers    PATCH /api/suppliers/:id
GET|POST /api/manifests    GET|PATCH /api/manifests/:id
POST   /api/invoices       PATCH|DELETE /api/invoices/:id
GET|POST /api/invoices/:id/line-items         PATCH|DELETE /api/line-items/:id
GET    /api/hs-codes/search?q=rum             GET /api/hs-codes/:code/rates
GET|POST /api/billing/invoices                GET /api/billing/invoices/:id
POST   /api/billing/invoices/:id/send|payments
GET    /api/customs-entries/:id/xml
```

Responses: `{ data, meta? }` on success, `{ error: { code, message, details? } }`
on failure. Money is always a string (`"13405.78"`). Auth: httpOnly session
cookie (browser) or `Authorization: Bearer <jwt>` (API clients).

## HS code data

`npm run db:seed` loads the bundled 1,544-line 2023 Tariff Schedule plus a
curated, legally sourced set of alcohol rate histories. Each rate has an
effective period, independent duty/excise bases, assessment units, source
metadata, and a verification flag. The PDF extraction contains customs duty
only; it is never treated as an authoritative excise source.

## Project layout

```
prisma/           schema, migrations, sql/ (indexes + RLS), seed.ts, seed.dev.ts*
src/app/api/      29 thin route handlers
src/app/          auth + operational home, directory, manifest, declaration, billing and accounting UI
src/lib/          env, errors, api-response, auth/, db/, calculations/, beaip/, validation/
src/server/       services/ (business rules) + repositories/
tests/            calculation, tenancy, tariff, TFP/XML, staleness and fresh-account workflow tests
scripts/smoke.ts  calculation → review-XML workflow verification
* gitignored
```
