---
name: submit-schema-and-migrations
description: >
  Database schema map and safe-change runbook for the Submit customs brokerage
  platform. Use when adding a field or model, changing an enum, tenant-scoping
  a new table, writing or debugging a Prisma migration, when prisma migrate /
  generate / db push fails, when adding or fixing an RLS policy, when deciding
  between migrate dev and db push, or after a migrate reset (RLS + trgm
  indexes must be reapplied).
---

# Submit — Schema and Migrations

Date-stamped: 2026-07-08. Ground truth: `prisma/schema.prisma` (v2.1.0, 712
lines), `prisma/migrations/20260707000000_init/`, `prisma/sql/rls.sql`,
`prisma/apply-rls.ts`, `src/lib/db/tenant-client.ts`, `prisma/seed.ts`,
`prisma/seed.dev.ts`, `README.md`, `package.json`.

## When NOT to use this skill

- Seed or environment **failures** (db:seed crashes, env vars, DATABASE_URL) → `submit-build-and-env`
- Tenancy **semantics** (how withAuth/JWT/tenant client behave at runtime) → `submit-auth-and-tenancy`
- System boundaries and layering rules → `submit-architecture-contract`
- Duty/VAT/levy math, Decimal handling → `submit-calculations-and-money`
- Bahamas customs domain facts (offices, tariff, declaration types) → `bahamas-customs-reference`
- Route handler shape, response envelopes → `submit-api-conventions`
- Zod schema style, test conventions → `submit-validation-and-qa`
- BEAIP submission work → `submit-beaip-integration-campaign`
- Approval workflow for schema changes → `submit-change-control` (this skill tells you WHEN approval is needed; that one tells you HOW)

---

## THE LOUDEST WARNING: RLS and trgm indexes are OUT-OF-BAND

`prisma/sql/rls.sql` is **NOT part of Prisma migrations**. It is applied
separately by `npm run db:rls` (runs `prisma/apply-rls.ts` over a raw `pg`
connection). Prisma does not model RLS policies, so it can neither detect nor
recreate them — and, because it does not track them, they cause no drift.

**Updated 2026-07-29:** the pg_trgm GIN indexes NO LONGER live out-of-band.
They are declared in `schema.prisma` (`type: Gin` + `ops: raw("gin_trgm_ops")`,
with `map:` pinning the existing `*_trgm_idx` names) and created by migration
`20260729000100_add_trgm_search_indexes`. `prisma/sql/indexes.sql` is deleted.
Prisma CAN express trigram GIN indexes; the earlier claim that it could not was
wrong, and the out-of-band workaround made every `prisma migrate dev` report
the indexes as drift and offer to reset the database.

Consequence: after **any** of these —

- `prisma migrate reset`
- `prisma db push --force-reset`
- pointing at a fresh database / new environment / new Neon branch

— the database has **no Row Level Security (layer-3 tenant isolation)** until
you rerun (the trgm indexes come back with the migrations now):

```bash
npm run db:rls
```

Nothing errors. Queries work. Isolation layer 3 and fuzzy search performance
just silently vanish. Layers 1–2 (tenant client + withAuth) still hold, but
the defense-in-depth backstop is gone. **Always rerun `db:rls` after any
schema apply on a reset or fresh DB.** Both SQL files are idempotent
(IF NOT EXISTS / DROP+CREATE), so rerunning is always safe.

`npm run db:setup` (`db:push && db:rls && db:seed && db:seed:dev`) does this
correctly — it is the reference sequence.

---

## Model map (23 models, schema declaration order preserved within groups)

### Tenancy & users
| Model | Purpose | Key relations |
|---|---|---|
| Organization | The tenant (brokerage firm). `slug` unique. | parent of everything tenant-scoped |
| User | Staff member with `role` (UserRole). `email` **globally** unique — an email belongs to one org, period. | → Organization; creates Shipments, uploads ShipmentDocuments, appears in AuditLog |

### Global transport lookups (NOT tenant-scoped)
| Model | Purpose | Key relations |
|---|---|---|
| Port | UN/LOCODE port (`unLocode` unique) | Journey origin/destination |
| CustomsOffice | Bahamas customs office (`code` unique: NAS, FPO, MSH, GGT, NEH) | ← Shipment.declarationOffice |
| ShippingAgent | Manifest-filing agent (`code` unique) | ← Manifest |
| Carrier | Shipping line/airline (`code` unique, TransportMode) | → Vessel |
| Vessel | Ship/aircraft (`imoNumber` unique) | Carrier → Vessel → Voyage |
| Journey | Port pair route; `@@unique([originPortId, destinationPortId])` | → Voyage |
| Voyage | Specific sailing; `@@unique([vesselId, voyageNumber])` | ← Manifest |

### HS code reference (global, seeded from Bahamas Tariff Schedule)
| Model | Purpose | Key relations |
|---|---|---|
| HSCode | Tariff line (`code` unique, e.g. "8703.23.10"); permit flags | → HSCodeRate (history), ← LineItem.hsCodeRef |
| HSCodeRate | Time-versioned rates (`effectiveFrom`/`effectiveTo`, NULL = active); dutyBasis + dutyRate + specificRate/Unit + vatRate/levyRate/exciseRate + processingFeeExempt | → HSCode |

### Tenant-scoped business data
| Model | Purpose | Key relations |
|---|---|---|
| Client | The brokerage's customer (importer) | → Shipment, BrokerageInvoice |
| Supplier | Overseas seller on commercial invoices | → Invoice |
| Manifest | Voyage-level grouping; `@@unique([organizationId, manifestNumber])` | Voyage + ShippingAgent → Shipments |
| Shipment | Core entity; `@@unique([organizationId, shipmentNumber])`; status DRAFT→SUBMITTED→CLEARED; charges + rolled-up totals + `calculatedAt` | Client, Manifest?, CustomsOffice, User(createdBy) → Invoices, Documents, CustomsEntries |
| ShipmentDocument | File metadata; bytes live in S3/R2 via `storageKey`, never Postgres. Cascade-deletes with Shipment. | Shipment, User(uploadedBy) |
| Invoice | Supplier's commercial invoice on a shipment. Cascade-deletes with Shipment. | Shipment, Supplier → LineItems |
| LineItem | The unit of duty calculation; `@@unique([invoiceId, lineNumber])`; frozen rates + calculated amounts. Cascade-deletes with Invoice. | Invoice, HSCode? |
| CustomsEntry | BEAIP declaration round trip; status machine DRAFT→…→RELEASED; `requestPayload`/`responsePayload` Json audit trail; `beaipReference` indexed | Shipment |
| BrokerageInvoice | What the brokerage bills its client; `@@unique([organizationId, invoiceNumber])` | Client → Items, Payments |
| BrokerageInvoiceItem | Billing line. **No organizationId** — child-scoped via parent. Cascade-deletes with BrokerageInvoice. | BrokerageInvoice, shipmentId? (loose link) |
| Payment | Money received against a BrokerageInvoice | Organization, BrokerageInvoice |
| AuditLog | Who did what; `changes`/`metadata` Json; entityType is a free string | Organization, User? |

## Tenant-scoping taxonomy (exact lists — verified 2026-07-08)

**Tenant-scoped (the 12 in `TENANT_MODELS`, src/lib/db/tenant-client.ts):**
`User, Client, Supplier, Manifest, Shipment, ShipmentDocument, Invoice,
LineItem, CustomsEntry, BrokerageInvoice, Payment, AuditLog`

Cross-checked against the schema: these are exactly the 12 models carrying an
`organizationId` column. No drift.

**Global reference (never scoped, read via `basePrisma`):**
`Port, CustomsOffice, ShippingAgent, Carrier, Vessel, Journey, Voyage,
HSCode, HSCodeRate`

**Special cases:**
- `Organization` — not in TENANT_MODELS, but rls.sql gives it its own policy: a tenant sees only its own row (`id = current_org_id`).
- `BrokerageInvoiceItem` — no organizationId; RLS scopes it through its parent BrokerageInvoice (EXISTS subquery in rls.sql). At the Prisma layer it is protected only by always being reached through its parent.
- `system_bypass` policies exist on `User`, `Organization`, `AuditLog` for pre-auth flows (login by email, registration) via `app.bypass_rls = 'on'`.

## Enums (15 — verified against schema and init migration)

| Enum | Values |
|---|---|
| UserRole | OWNER, ADMIN, BROKER, CLERK, VIEWER |
| TransportMode | SEA, AIR, LAND |
| DutyBasis | AD_VALOREM, SPECIFIC, COMPOUND |
| ClientType | INDIVIDUAL, BUSINESS |
| ManifestStatus | OPEN, CLOSED |
| ShipmentStatus | DRAFT, SUBMITTED, CLEARED, CANCELLED |
| GoodsType | GENERAL, PERSONAL_EFFECTS, COMMERCIAL, VEHICLE, HAZARDOUS, PERISHABLE |
| PackageType | CONTAINER, PALLET, CARTON, CRATE, DRUM, BUNDLE, LOOSE, VEHICLE, OTHER |
| DocumentType | COMMERCIAL_INVOICE, BILL_OF_LADING, AIRWAY_BILL, PACKING_LIST, PERMIT, CERTIFICATE_OF_ORIGIN, RECEIPT, OTHER |
| ExemptionType | NONE, FULL, PARTIAL, CONDITIONAL |
| CustomsEntryStatus | DRAFT, VALIDATED, SUBMITTED, UNDER_ASSESSMENT, ASSESSED, PAID, RELEASED, REJECTED, CANCELLED |
| DeclarationType | C13 (home consumption), C14 (temporary import), C17 (warehouse), C18 (transshipment), OTHER |
| BrokerageInvoiceStatus | DRAFT, SENT, PARTIALLY_PAID, PAID, VOID |
| PaymentMethod | CASH, CHEQUE, BANK_TRANSFER, CARD, OTHER |
| AuditAction | CREATE, UPDATE, DELETE, SUBMIT, STATUS_CHANGE, LOGIN, LOGOUT |

## Field conventions

- **IDs**: `String @id @default(cuid())` everywhere. No uuid, no autoincrement.
- **Money**: always `Decimal`, always BSD. Precision by role:
  - Rates: `@db.Decimal(6, 4)` — decimal fractions, `0.4500` = 45%
  - Specific rates (BSD per unit): `@db.Decimal(12, 4)`
  - Unit prices: `@db.Decimal(12, 4)`; line-level amounts: `@db.Decimal(12, 2)`
  - Shipment/invoice roll-up totals: `@db.Decimal(14, 2)`
  - Quantities and weights: `@db.Decimal(12, 3)`
  - Never floats. Application math uses decimal.js (see submit-calculations-and-money).
- **Rate freezing on LineItem**: `dutyBasis, dutyRate, specificRate,
  specificRateUnit, vatRate, levyRate, exciseRate` are copied from the active
  HSCodeRate at calculation time so shipment numbers stay auditable after
  tariff changes. Never "fix" a LineItem by re-reading live rates in place.
- **Staleness guard**: `Shipment.calculatedAt` is cleared by any
  invoice/line-item mutation; submission refuses until recalculated. New
  mutations touching invoice/line data must preserve this behavior.
- **BEAIP audit trail**: `CustomsEntry.requestPayload` / `responsePayload`
  (Json) store the exact payload sent/received. Write-once per submission;
  do not repurpose.
- **Rate history**: HSCodeRate rows are append-only in spirit — close a rate
  by setting `effectiveTo`, then insert the new row. `effectiveTo = NULL`
  means currently active.
- **Denormalized-on-purpose**: `LineItem.hsCode` (code string at entry time,
  alongside optional `hsCodeId` FK) and `Shipment.transportMode` (from
  voyage.vessel.mode). Do not "normalize away."
- **File bytes**: never in Postgres — `ShipmentDocument.storageKey` only.
- **Unique constraints worth knowing**:
  - Per-org number uniqueness pattern: `Manifest @@unique([organizationId, manifestNumber])`, `Shipment @@unique([organizationId, shipmentNumber])`, `BrokerageInvoice @@unique([organizationId, invoiceNumber])`. Any new per-org human-reference number MUST follow this pattern (org-compound, not global).
  - `User.email` is globally unique (cross-org) — intentional, supports login-by-email before org context exists.
  - `LineItem @@unique([invoiceId, lineNumber])`, `Journey @@unique([originPortId, destinationPortId])`, `Voyage @@unique([vesselId, voyageNumber])`.
  - Global naturals: Organization.slug, Port.unLocode, CustomsOffice.code, ShippingAgent.code, Carrier.code, Vessel.imoNumber, HSCode.code.

## Indexing conventions

- **In-schema (`@@index`)**: list screens use composite
  `[organizationId, status, createdAt(sort: Desc)]` (Manifest, Shipment,
  CustomsEntry; BrokerageInvoice uses issueDate). Simple FKs get plain
  indexes. Lookup-active pattern: `[organizationId, isActive]` (Client,
  Supplier). Rate lookup: `[hsCodeId, effectiveFrom]`. New tenant tables
  should lead composite indexes with `organizationId`.
- **Trigram GIN (in `schema.prisma`, created by migrations)**: 6 pg_trgm
  indexes for fuzzy search — HSCode.description, Client.name, Supplier.name,
  Shipment.description, LineItem.description, LineItem.commercialDescription.
  Declared as `@@index([col(ops: raw("gin_trgm_ops"))], type: Gin, map: "...")`
  with the extension declared via `datasource.extensions = [pg_trgm]` +
  `previewFeatures = ["postgresqlExtensions"]`. A new fuzzy-searched text
  column gets its index HERE — declaring it anywhere else reintroduces drift.

## Migration story

- Exactly **one** migration: `prisma/migrations/20260707000000_init/migration.sql`.
- Verified in sync with the working schema (2026-07-08): 23 CREATE TABLE and
  15 CREATE TYPE statements matching the schema's 23 models / 15 enums, and
  it includes the v2.1.0 additions (`beaipReference`, `requestPayload`,
  `specificRate`/`specificRateUnit`, `calculatedAt`). 45 index/unique-index
  statements. No pending drift.
- **`db push` vs `migrate` coexistence** — both are sanctioned, for different
  jobs:
  - `npm run db:push` (used by `db:setup`) — local/dev iteration; no migration files written. The default dev loop.
  - `npx prisma migrate deploy` — production/CI apply of committed migrations (README deploy steps use this; quick start says "migrate deploy or db push").
  - `npm run db:migrate` (`prisma migrate dev`) — when a change must become a committed migration file for deployment. Beware: dev-schema drift from prior `db push` use can make `migrate dev` demand a reset — which wipes data AND (see warning above) strips RLS/indexes until `db:rls` reruns.
- The generator writes the client to `../src/generated/prisma`
  (`provider = "prisma-client"`, runtime nodejs). App code imports from
  `@/generated/prisma` — never `@prisma/client` directly. `postinstall` runs
  `prisma generate`.

## HOW TO CHANGE THE SCHEMA — checklist

1. **Edit `prisma/schema.prisma`.** Follow the conventions above (cuid ids, Decimal money with correct precision, org-compound uniques, organizationId-led indexes).
2. **Get owner approval** per `submit-change-control` before applying anything. Schema changes are controlled changes.
3. **Apply**: dev iteration → `npm run db:push`; change destined for deployment → `npm run db:migrate` (migrate dev) to produce a migration file; production → `npx prisma migrate deploy`.
4. **`npx prisma generate`** (or rely on db:push/migrate dev doing it) so `src/generated/prisma` matches.
5. **IF the new model is tenant-scoped** (carries `organizationId`) — the THREE-PLACE UPDATE, the trap unique to this codebase:
   1. Add the model name to `TENANT_MODELS` in `src/lib/db/tenant-client.ts` (else layer-1 scoping silently skips it — queries run unscoped).
   2. Add the table to the `tenant_tables` array in `prisma/sql/rls.sql` (else no layer-3 policy). Child tables without organizationId get a parent-EXISTS policy like BrokerageInvoiceItem's.
   3. Rerun `npm run db:rls`.
   Miss any one and tenant isolation for that table is partial or absent, with no error anywhere.
6. **If you reset or hit a fresh DB at any point**: rerun `npm run db:rls` (see the loud warning) and reseed (`db:seed`, then `db:seed:dev` for dev tenants — seed.ts is global reference data only: customs offices, ports, carriers, agents, HS codes + rates; seed.dev.ts creates the two test orgs and demo shipment).
7. **Update seeds** if the change touches seeded models (both seed files are idempotent upserts keyed on natural identifiers — keep it that way).
8. **Update validation** in `src/lib/validation/schemas.ts` (Zod) for any new/changed API-facing fields.
9. **`npm test`** — the suite includes live tenant-isolation tests that will catch a missing TENANT_MODELS entry.

Never run destructive commands (`migrate reset`, `db push --force-reset`,
`--accept-data-loss`) against a shared or production database without
explicit owner sign-off via submit-change-control.

## Provenance and maintenance

- Model/enum counts: `grep -cE '^model ' prisma/schema.prisma` → 23; `grep -cE '^enum ' prisma/schema.prisma` → 15 (recount after any schema change and fix this doc).
- TENANT_MODELS extraction: `sed -n '/TENANT_MODELS = new Set/,/])/p' src/lib/db/tenant-client.ts` → must list exactly the schema's organizationId-bearing models (12 as of 2026-07-08).
- RLS policy count: effective policies → 17 (14 tenant_isolation: 12 via the DO-loop over tenant_tables + BrokerageInvoiceItem + Organization; 3 system_bypass: User, Organization, AuditLog). Note `grep -c 'CREATE POLICY' prisma/sql/rls.sql` → 6, because the 12 looped policies are one EXECUTE format(...) inside the DO block; verify live with `SELECT count(*) FROM pg_policies WHERE policyname IN ('tenant_isolation','system_bypass')`.
- trgm index count: `grep -c 'gin_trgm_ops' prisma/schema.prisma` → 6.
- Migration sync spot-check: `grep -c 'CREATE TABLE' prisma/migrations/20260707000000_init/migration.sql` → 23; `grep -c 'CREATE TYPE'` → 15.
