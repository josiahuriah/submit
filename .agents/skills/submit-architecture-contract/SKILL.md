---
name: submit-architecture-contract
description: >-
  The load-bearing architectural decisions, invariants, and known weak points
  of the Submit codebase (multi-tenant customs brokerage SaaS for The Bahamas).
  This is a CO-LOAD skill: load it ALONGSIDE the task-specific skill whenever
  you are designing a new feature, reviewing or refactoring existing code,
  adding a route/service/model, touching tenant isolation, or deciding where
  new logic belongs (route vs service vs repository). Also load it before
  answering "why is it built this way", "is it safe to change X", or
  "what could break" questions about Submit.
---

# Submit — Architecture Contract

Submit (v0.3.0, canonical repo root `/Users/joshduncanson/Documents/Documents/Development/Submit/submit`) is a
multi-tenant SaaS for Bahamian customs brokerages: prepare shipments,
calculate duty/VAT/levy/excise to the cent, generate TFP v1.4.4 XML review
artifacts, and bill clients. Direct Customs submission is intentionally absent
until the government releases endpoint documentation. Stack: Next.js 16.3 App Router, React 19.2,
TypeScript, Prisma 7 (driver adapter), PostgreSQL (Neon), Zod v3,
decimal.js, Vitest, tsx. README.md is the document of record; formal TFP docs
live under `docs/tfp/`.

This skill records the decisions you must not silently reverse, the
invariants you must re-verify after any change, and the weak points to keep
in mind. It does NOT teach domain math, setup, schema detail, or security
implementation depth — see the pointers below.

## When NOT to use

- Computing or explaining duty/VAT/levy amounts or Bahamian tariff rules →
  `submit-calculations-and-money` and `bahamas-customs-reference`.
- Installing, running, env vars, seeding → `submit-build-and-env`.
- Editing `prisma/schema.prisma`, migrations, RLS SQL mechanics →
  `submit-schema-and-migrations`.
- Auth/JWT/RBAC implementation details → `submit-auth-and-tenancy`.
- Request/response envelope, pagination, route wiring conventions →
  `submit-api-conventions`.
- Writing tests or running QA → `submit-validation-and-qa`.
- BEAIP production cutover work → `submit-beaip-integration-campaign`.
- Deciding whether a change is allowed at all → `submit-change-control`.

## Load-bearing decisions (with WHY)

"Stated" = written down in README.md or a code comment. "Derived" = inferred
from reading the code; re-check before relying on it.

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | Three-layer tenant isolation: (1) Prisma client extension injects `organizationId` into every query/write on the 12 tenant-scoped models, including `findUnique`; (2) `withAuth()` builds a per-request tenant client from verified JWT claims; (3) Postgres RLS with `FORCE ROW LEVEL SECURITY` + transaction-scoped `set_config('app.current_org_id', $org, true)` | Application code physically cannot forget the tenant filter (layer 1); orgId comes from the verified token, never user input (layer 2); a bug in layers 1–2 still cannot leak rows (layer 3). `FORCE` is required because Neon's `neondb_owner` owns the tables and owners bypass RLS otherwise. Transaction-scoped `set_config` is the only form safe under PgBouncer transaction pooling | Stated — README "Tenant isolation" table; header comments in `src/lib/db/tenant-client.ts` and `prisma/sql/rls.sql` |
| 2 | The extension wraps every operation in a batch `$transaction([set_config, query])` | Guarantees `set_config` and the query run on the SAME pooled connection, and the setting dies with the transaction — session-level SET would leak onto whichever request borrows the connection next under PgBouncer | Stated — comments in `tenant-client.ts` (~lines 125–131) and `src/lib/db/prisma.ts` |
| 3 | `db.$tenantTransaction(fn)` is the sanctioned escape hatch for multi-write atomicity (used by calculation persist and payment+balance update only). Inside it, RLS is the enforcement layer | The per-operation extension wrapping cannot span statements; one interactive transaction sets the RLS variable first | Stated — README + `tenant-client.ts` docstring; call sites in `calculations.service.ts:118`, `billing.service.ts:131` |
| 4 | `basePrisma` (unscoped) lives ONLY in `src/lib/db/prisma.ts`, is consumed by `tenant-client.ts`, and is otherwise used only for global reference data through `hs-codes.service.ts`, `transport-references.service.ts`, and one existing CustomsOffice picker in `shipment-actions.ts`. Pre-auth flows (login/registration) use `systemQuery()` which sets an `app.bypass_rls` transaction flag | Global lookup models (HSCode, Port, CustomsOffice, Carrier, Vessel, Voyage, Journey, ShippingAgent, HSCodeRate) are shared reference data, not tenant rows; login must find a user before an org context exists. "This file is the only place a raw, unscoped client exists" | Stated — `prisma.ts` header comment; derived — grep confirms the current usage set |
| 5 | Layered flow: thin route (Zod validation only) → service (business rules + audit) → repository/TenantClient (data). Only shipments has a repository; catalog entities (clients/suppliers/manifests) go service→TenantClient directly | "A full repository layer would be ceremony without benefit" for simple CRUD; `shipments.repository.ts` is "the pattern to copy when an entity grows real query complexity" | Stated — README architecture line + `catalog.service.ts` header comment |
| 6 | Permission checks happen in `withAuth(handler, { permission })` at the route boundary, mapped via `src/lib/auth/rbac.ts` (`VIEWER < CLERK < BROKER < ADMIN < OWNER`). Review artifact generation uses `shipments:write`; `shipments:submit` remains reserved for a future verified endpoint | Clerks can prepare stakeholder files; eventual legal filing stays BROKER+ | Stated — README "RBAC"; derived from artifact route and `rbac.ts` |
| 7 | Calculation engine is pure, deterministic, decimal.js-only. Duty and excise independently support AD_VALOREM / SPECIFIC / COMPOUND / ADDITIVE; invoice FOB converts to BSD before largest-remainder apportionment; VAT includes duty/excise/levy and the bounded processing fee is VAT-able | Precise, auditable customs prediction without native-float drift | Stated — README + calculation modules |
| 8 | Effective-dated rate selection and freezing: declaration date selects the active rate; bases, amounts, units, converted assessment quantities, and BSD FOB are copied to each LineItem | Historical calculations remain reproducible after rate/unit changes | Stated — README + `calculations.service.ts` |
| 9 | Staleness guard: invoice/line mutations clear `calculatedAt`; artifact generation refuses a missing/stale calculation. Declaration-profile edits automatically reprice an already-calculated draft | A reviewer must never receive XML backed by stale predicted amounts | `invoices.service.ts`, `declaration-artifacts.service.ts`, `declaration-profile.ts` |
| 10 | Customs integration currently ends at a versioned, preflighted WCO XML review artifact. Exact XML and validation metadata are stored in CustomsEntry; generating it never changes Shipment status or calls an endpoint | Endpoint/auth/envelope assumptions are not authorized before Customs step 4 | README + `declaration-artifacts.service.ts`; hypothetical SOAP/mock clients removed 2026-08-08 |
| 11 | Uniform envelope: `{ data, meta? }` / `{ error: { code, message, details? } }`; AppError subclasses (`src/lib/errors.ts`) carry status+code and are mapped centrally in `src/lib/api-response.ts` `fail()`; unknown errors log server-side and return a generic 500. Money is always serialized as a string | One mapping point; internals never leak to clients; float-safe money on the wire | Stated — README + `api-response.ts` comments |
| 12 | Env access only via `src/lib/env.ts` — Zod-validated, cached, fail-fast. Auth token = httpOnly session cookie OR `Authorization: Bearer` | "Fail fast at boot instead of deep inside a request handler" | Stated — `env.ts` comment; README |

## Invariants — re-verify after any change

Run these from the repo root. Every check has an expected result; a
deviation means either a regression or a deliberate decision that must be
recorded here.

| Invariant | Check (copy-paste) | Expected (as of 2026-08-08) |
|---|---|---|
| `basePrisma` never leaks into request code | `grep -rln "basePrisma" src --include='*.ts'` | Exactly: `src/lib/db/prisma.ts`, `src/lib/db/tenant-client.ts`, `src/server/services/hs-codes.service.ts`, `src/server/services/transport-references.service.ts`, and the known `src/lib/data/shipment-actions.ts` CustomsOffice picker. Any additional request/data file appearing here is a tenant-isolation bug |
| `systemQuery` used only pre-auth | `grep -rln "systemQuery" src --include='*.ts'` | Exactly: `src/lib/db/prisma.ts`, `src/server/services/auth.service.ts` |
| Every non-auth route goes through `withAuth` | `grep -rL "withAuth" $(find src/app/api -name route.ts)` | Exactly three files: `src/app/api/auth/login/route.ts`, `register/route.ts`, `logout/route.ts` (the only intentionally pre-auth routes; `auth/me` DOES use withAuth) |
| Tenant model list consistent across layer 1 and layer 3 | `grep -A14 "TENANT_MODELS" src/lib/db/tenant-client.ts` and `grep -A4 "tenant_tables" prisma/sql/rls.sql` | Same 12 models in both: User, Client, Supplier, Manifest, Shipment, ShipmentDocument, Invoice, LineItem, CustomsEntry, BrokerageInvoice, Payment, AuditLog. Adding an `organizationId`-bearing model to schema.prisma without adding it to BOTH lists silently un-isolates it |
| RLS is FORCE'd | `grep -c "FORCE ROW LEVEL SECURITY" prisma/sql/rls.sql` | ≥1 (applied per-table in a loop over the 12 tenant tables) |
| Staleness guard intact | `grep -rn "calculatedAt" src/server/services/invoices.service.ts src/server/services/declaration-artifacts.service.ts` | invoice/line mutations invalidate; artifact generation rejects missing or stale calculations |
| No unverified endpoint client | `grep -rn "BEAIP_MODE\|ProductionBeaipClient\|MockBeaipClient" src .env.example` | No matches |
| No floats in money paths | `grep -rn "parseFloat\|Number(" src/lib/calculations --include='*.ts'` | Exactly one benign hit: `apportionment.ts:67` `.toNumber()` on an integer cent count (commented "small integer"). Any new hit — especially `parseFloat` or float arithmetic on amounts — is a bug (decimal.js everywhere; `Decimal.ROUND_HALF_UP`, 2dp, set in `money.ts`) |
| Review XML persisted verbatim | `grep -n "requestPayload" src/server/services/declaration-artifacts.service.ts` | Exact XML string written with schema/mapping/validation metadata |
| Multi-write atomicity uses the escape hatch | `grep -rn 'tenantTransaction' src --include='*.ts' \| grep -v tenant-client` | Exactly two call sites: `calculations.service.ts`, `billing.service.ts`. New multi-write flows must use it too, never sequential scoped writes |
| Tests still pass | `npm test` | All pure and live-DB suites pass; then `npx tsx scripts/smoke.ts` on a seeded local DB for calculate→artifact |

## Layering contract

Derived from `src/app/api/**/route.ts`, `src/server/services/*.ts`,
`src/server/repositories/shipments.repository.ts`, and the README.

**Route handlers** (`src/app/api/`, 29 routes) may ONLY: wrap themselves in
`withAuth(handler, { permission })`, await `params`, parse the body with a
Zod schema from `src/lib/validation/schemas.ts`, call one service method
with the injected `{ db, audit, claims }`, and return via
`ok()`/`created()` from `src/lib/api-response.ts`. No business logic, no
direct Prisma model calls beyond what the service exposes, no try/catch
(withAuth's central `fail()` handles errors). A typical route body is under
10 lines — keep it that way.

**Services** (`src/server/services/`) own business rules, cross-entity
orchestration, audit writes (`writeAudit` from `src/lib/audit.ts`), and
error throwing (AppError subclasses only). They receive a `TenantClient` —
they never construct one and never import `basePrisma` (current exceptions:
`hs-codes.service.ts` and `transport-references.service.ts` for global
reference data, plus `auth.service.ts` via `systemQuery` for pre-auth flows). They call the pure
calculation functions in `src/lib/calculations/`; they do not reimplement
math.

**Repositories** (`src/server/repositories/`) exist only where query
complexity earns them — today that is shipments only. Simple CRUD goes
service→TenantClient directly (see `catalog.service.ts` header for the
stated rationale). Do not add a repository for a new entity unless its
queries are genuinely complex; do copy `shipments.repository.ts` when they
are.

**`src/lib/`** holds pure/infrastructure code with no per-request tenant
state of its own: calculations, TFP XML mapping, errors, env, api-response,
auth plumbing, and the tenant client factory itself.

## Data flow (current gate: calculate → review artifact)

1. `POST /api/shipments/:id/calculate` → `withAuth` verifies the JWT,
   checks permission, builds a `TenantClient` for `claims.orgId`.
2. `calculations.service` loads shipment + invoices + line items (scoped),
   runs the pure functions in `src/lib/calculations/` (apportion charges,
   compute duty/excise/levy/VAT/fee per line), then persists totals, frozen
   rates, and `calculatedAt` atomically via `$tenantTransaction`.
3. Any later invoice/line-item edit → `invoices.service` nulls
   `shipment.calculatedAt`.
4. `POST /api/shipments/:id/artifacts` → mapper → mandatory-field preflight →
   WCO builder → well-formedness check → exact XML and version metadata on a
   `CustomsEntry`. Shipment remains DRAFT.
5. `GET /api/customs-entries/:id/xml` returns the tenant-scoped XML as a
   no-store attachment. No Single Window endpoint exists in the app yet.

## Weak points — verified 2026-08-08

Stated plainly. Re-verify status before acting on any of these.

1. **Version control is active.** The canonical repo is on `main` with a GitHub
   remote. Commits and pushes remain owner-directed under `submit-change-control`.
2. **Leaked database credential.** README states the Neon connection string
   was shared in a chat session during development and the password must be
   rotated in the Neon console before real client data touches the
   database. A populated `.env` is present at the repo root (correctly
   gitignored — but see point 1). Treat the current credential as
   compromised until rotation is confirmed.
3. **Direct endpoint integration is intentionally absent.** Customs has not
   released transport/auth/response documentation. Do not reintroduce guessed
   SOAP/ASYCUDA scaffolding or describe XML review as live filing.
4. **Core operational UI is functional but not full-product complete.** Home,
   directory CRUD, manifests, shipment editing, declarations, billing and
   accounting are wired. Attachments, team administration, reporting and
   production Customs transport remain later phases.
5. **The full 1,544-code tariff extraction is bundled, but it is duty-only.**
   Excisable chapters require separately verified curated rate rows; unverified
   excisable lines fail calculation safely.
6. **No rate limiting anywhere** (grep for rate-limit terms in `src/`
   returns nothing), including on `/api/auth/login` — brute-force exposure
   once deployed.
7. **Database setup remains multi-step.** Five migrations are checked in, but
   RLS and pg_trgm setup still run out-of-band through `npm run db:rls`.
8. **RLS is inert on local superuser Postgres** (owners/superusers bypass
   it) — locally only layers 1–2 protect you, which is exactly what
   `tests/tenant-isolation.test.ts` proves. On Neon, RLS is real because
   `neondb_owner` is not a superuser and FORCE is applied (stated in
   README).

## Provenance and maintenance

Everything above was re-verified from the canonical repo on 2026-08-12
(package.json version 0.3.0). One-liners to re-verify the volatile facts:

- Version/stack: `grep '"version"' package.json && grep -E '"(next|zod|@prisma/client)"' package.json`
- Route count (expect 29): `find src/app/api -name route.ts | wc -l`
- Schema size (expect 23 models, 15 enums, 712 lines): `grep -c '^model ' prisma/schema.prisma; grep -c '^enum ' prisma/schema.prisma; wc -l prisma/schema.prisma`
- Tenant model lists still match: see invariants table row 4.
- Full HS dataset present: `node -e 'console.log(require("./prisma/data/hs-codes.json").length)'` (expect 1544)
- Test inventory: `npm test`.

If any check disagrees with this file, the code wins — update this skill.
