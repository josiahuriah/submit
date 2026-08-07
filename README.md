# Submit

Multi-tenant SaaS for Bahamian customs brokerages: prepare shipments, calculate
duty/VAT/levy/excise **to the cent before submission**, file declarations through
BEAIP, and bill clients — with hard tenant isolation between brokerage firms.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 7 (driver adapter) ·
PostgreSQL (Neon) · Tailwind CSS v4 · Zod · decimal.js · Vitest

---

## Quick start (local)

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

Log in with `broker@bahamabrokerage.test` / `Password123!` and press
**Calculate**, then **Submit** on shipment `SHP-2026-00001`.

### Verifying everything

```bash
npm test                      # 34 tests: calculations, tenant isolation, tariff import, WCO XML
npx tsx scripts/smoke.ts      # end-to-end: calculate → verify math → submit via mock BEAIP
npm run wco:generate          # TFP declaration XML from a calculated shipment + XSD validation
```

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** connection string in production |
| `JWT_SECRET` | yes | ≥32 random chars: `openssl rand -hex 32` |
| `SESSION_TTL_SECONDS` | no | default 43200 (12h) |
| `BEAIP_MODE` | no | `mock` (default) or `production` |
| `BEAIP_ENDPOINT` / `BEAIP_USERNAME` / `BEAIP_PASSWORD` / `BEAIP_BROKER_CODE` | prod only | required when `BEAIP_MODE=production` |

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
3. Set `JWT_SECRET` (fresh value) and `BEAIP_MODE=mock` on Vercel. Deploy.

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
- **Duty** (`duty-calculator.ts`): `AD_VALOREM` (CIF × rate), `SPECIFIC`
  (qty × BSD/unit — alcohol, fuel; the accuracy gap competitors miss),
  `COMPOUND` (greater of the two). Excise and environmental levy on CIF.
  VAT on (CIF + duty + excise + levy). Processing fee 1% of shipment CIF,
  clamped $10–$750, plus VAT on the fee.
- **Rate freezing**: at calculation time the applied rates are copied onto each
  LineItem, so a shipment's numbers remain auditable after tariff changes.
- **Staleness guard**: any invoice/line-item mutation clears
  `shipment.calculatedAt`; submission refuses until recalculated.

### BEAIP integration (`src/lib/beaip/`)

One `BeaipClient` interface, two implementations, chosen by `BEAIP_MODE`:

- **mock** — full workflow simulation: validates HS formats, returns
  `BS-YYYY-E######` references; a `brokerReference` containing `REJECT` forces
  the rejection path for testing.
- **production** — complete SOAP client (fast-xml-parser, WS-Security
  UsernameToken, 60s timeout). When CrimsonLogic's WSDL documentation arrives,
  only the namespace/action/element names in `buildEnvelope()` /
  `parseResponse()` should need adjusting.

Every request/response payload is persisted verbatim on
`CustomsEntry.requestPayload/responsePayload` — rejections included. Filed
declarations are legal documents; the audit trail is non-negotiable.

### RBAC

`VIEWER < CLERK < BROKER < ADMIN < OWNER`. The one domain-critical rule:
**`shipments:submit` requires BROKER+** — clerks prepare, licensed brokers file.

---

## API surface (27 routes)

```
POST   /api/auth/register|login|logout        GET /api/auth/me
GET|POST /api/shipments                       GET|PATCH|DELETE /api/shipments/:id
POST   /api/shipments/:id/status|calculate|submit
GET    /api/shipments/:id/invoices
GET|POST /api/clients      GET|PATCH /api/clients/:id
GET|POST /api/suppliers    PATCH /api/suppliers/:id
GET|POST /api/manifests    GET|PATCH /api/manifests/:id
POST   /api/invoices       PATCH|DELETE /api/invoices/:id
GET|POST /api/invoices/:id/line-items         PATCH|DELETE /api/line-items/:id
GET    /api/hs-codes/search?q=rum
GET|POST /api/billing/invoices                GET /api/billing/invoices/:id
POST   /api/billing/invoices/:id/send|payments|convert
POST   /api/customs-entries/:id/refresh
```

Responses: `{ data, meta? }` on success, `{ error: { code, message, details? } }`
on failure. Money is always a string (`"13405.78"`). Auth: httpOnly session
cookie (browser) or `Authorization: Bearer <jwt>` (API clients).

**Quotes vs invoices.** `POST /api/billing/invoices` generates either a
billable `INVOICE` (default) or a non-binding `QUOTE` (proforma estimate) via
the `kind` field — both share the same subtotal/VAT/total math. A quote never
accrues payments; once the client accepts, `POST
/api/billing/invoices/:id/convert` copies its line items and frozen totals into
a new invoice (fresh `invoiceNumber` required) and links the two 1:1. List
screens filter with `?kind=QUOTE` / `?kind=INVOICE`.

## HS code data

`npm run db:seed` loads a 43-code representative subset covering every duty
basis. Drop the full 1,544-code extraction at `prisma/data/hs-codes.json`
(same shape as `HS_SUBSET` in `prisma/seed.ts`) and re-run the seed to load the
complete 2023 Tariff Schedule.

## Project layout

```
prisma/           schema, migrations, sql/ (indexes + RLS), seed.ts, seed.dev.ts*
src/app/api/      26 thin route handlers
src/app/          login + dashboard (demo UI)
src/lib/          env, errors, api-response, auth/, db/, calculations/, beaip/, validation/
src/server/       services/ (business rules) + repositories/
tests/            calculation engine (11) + tenant isolation (5)
scripts/smoke.ts  end-to-end workflow verification
* gitignored
```
