---
name: submit-api-conventions
description: >
  API route-handler contract for the Submit codebase (29 implemented routes under
  src/app/api). Use when adding or modifying an endpoint, reviewing a route handler,
  answering questions about response shape ({data, meta?} / {error:{code,message,details?}}),
  cursor pagination, Zod request schemas, permission wiring (withAuth), or how
  400/401/403/404/409/422/500 map to error codes. Also use when a route returns an
  unexpected envelope or a Zod validation error shape needs explaining.
---

# Submit API Conventions

Updated 2026-08-08. Everything below is mined from the 29 implemented `route.ts`
files and the four contract files they depend on:

- `src/lib/api-response.ts` — response envelope + central error mapping
- `src/lib/errors.ts` — AppError hierarchy (status + code per class)
- `src/lib/auth/with-auth.ts` — handler wrapper (auth, RBAC, tenant client, audit ctx, catch-all)
- `src/lib/validation/schemas.ts` — all Zod v3 request schemas
- `src/lib/db/pagination.ts` — cursor pagination contract

## When NOT to use this skill

- **Auth internals, JWT, RBAC role ladder, tenant isolation / RLS depth** → `submit-auth-and-tenancy`.
  This skill only records *which* permission string each route passes to `withAuth`.
- **Duty/VAT math, apportionment, Decimal handling** that `calculate`/`submit` routes invoke →
  `submit-calculations-and-money`. This skill stops at the service-call boundary.
- Layer map / dependency rules → `submit-architecture-contract`. Schema/migrations →
  `submit-schema-and-migrations`. Build/env → `submit-build-and-env`. BEAIP integration work →
  `submit-beaip-integration-campaign`. Tariff domain → `bahamas-customs-reference`.
  QA → `submit-validation-and-qa`. Process → `submit-change-control`.

## Route inventory (29 route files, 38 exported handlers)

Permissions below were extracted from the actual `{ permission: '...' }` option in each file
(command in Provenance). Roles: VIEWER(0) < CLERK(1) < BROKER(2) < ADMIN(3) < OWNER(4);
minimum role per permission is in `src/lib/auth/rbac.ts`.

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | /api/auth/register | *(public — no withAuth)* | manual try/catch + `fail()` |
| POST | /api/auth/login | *(public — no withAuth)* | manual try/catch + `fail()` |
| POST | /api/auth/logout | *(public — no withAuth)* | no try/catch (nothing throws) |
| GET | /api/auth/me | *(withAuth, no permission)* | auth-only; any role |
| GET | /api/auth/google | *(public OAuth redirect)* | login/signup intent + signed state |
| GET | /api/auth/google/callback | *(public OAuth callback)* | validates state/nonce; sets session |
| GET | /api/shipments | shipments:read | paginated |
| POST | /api/shipments | shipments:write | injects `createdById: claims.sub` |
| GET | /api/shipments/:id | shipments:read | |
| PATCH | /api/shipments/:id | shipments:write | DRAFT-only (service rule) |
| DELETE | /api/shipments/:id | shipments:write | DRAFT-only (service rule) |
| POST | /api/shipments/:id/status | shipments:write | DRAFT cancellation only; filing states are endpoint-owned |
| POST | /api/shipments/:id/calculate | shipments:write | |
| POST | /api/shipments/:id/artifacts | shipments:write | Generates/stores review XML; never submits |
| GET | /api/shipments/:id/invoices | shipments:read | |
| GET | /api/clients | clients:read | paginated |
| POST | /api/clients | clients:write | |
| GET | /api/clients/:id | clients:read | |
| PATCH | /api/clients/:id | clients:write | |
| GET | /api/suppliers | clients:read | reuses clients:* — see Findings |
| POST | /api/suppliers | clients:write | |
| PATCH | /api/suppliers/:id | clients:write | |
| GET | /api/manifests | shipments:read | paginated |
| POST | /api/manifests | shipments:write | |
| GET | /api/manifests/:id | shipments:read | |
| PATCH | /api/manifests/:id | shipments:write | |
| POST | /api/invoices | shipments:write | supplier invoice, belongs to shipment |
| PATCH | /api/invoices/:id | shipments:write | |
| DELETE | /api/invoices/:id | shipments:write | |
| GET | /api/invoices/:id/line-items | shipments:read | |
| POST | /api/invoices/:id/line-items | shipments:write | merges `invoiceId` from path into body before parse |
| PATCH | /api/line-items/:id | shipments:write | |
| DELETE | /api/line-items/:id | shipments:write | |
| GET | /api/hs-codes/search | shipments:read | handler ignores `db` — HS codes are global reference data |
| GET | /api/hs-codes/:code/rates | shipments:read | full effective-dated source ledger |
| GET | /api/billing/invoices | billing:read | paginated |
| POST | /api/billing/invoices | billing:write | |
| GET | /api/billing/invoices/:id | billing:read | |
| POST | /api/billing/invoices/:id/send | billing:write | |
| POST | /api/billing/invoices/:id/payments | billing:write | |
| GET | /api/customs-entries/:id/xml | shipments:read | raw XML attachment, the intentional response-envelope exception |

## The canonical handler pattern (real code, not a template)

Reference: `src/app/api/shipments/route.ts` — the cleanest example of both a
paginated list and a create.

```ts
import { withAuth } from '@/lib/auth/with-auth'
import { shipmentsService } from '@/server/services/shipments.service'
import { shipmentCreateSchema, shipmentListQuery } from '@/lib/validation/schemas'
import { ok, created } from '@/lib/api-response'

export const GET = withAuth(async (req, { db }) => {
  const query = shipmentListQuery.parse(Object.fromEntries(req.nextUrl.searchParams))
  const page = await shipmentsService.list(db, query)
  return ok(page.items, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } })
}, { permission: 'shipments:read' })

export const POST = withAuth(async (req, { db, audit, claims }) => {
  const input = shipmentCreateSchema.parse(await req.json())
  const shipment = await shipmentsService.create(db, audit, {
    ...input,
    createdById: claims.sub,
  })
  return created(shipment)
}, { permission: 'shipments:write' })
```

Anatomy, in order:

1. **`withAuth(handler, { permission })`** — the wrapper does everything security-related:
   extracts token (Bearer header first, then `submit_session` cookie), verifies JWT,
   runs `requirePermission(claims.role, permission)`, builds a tenant-scoped Prisma
   client from `claims.orgId`, builds an `AuditContext` (userId, ip, userAgent), and
   wraps the whole handler in `try { … } catch (e) { return fail(e) }`. Handlers never
   see the unscoped Prisma client and never write their own try/catch.
2. **Zod parse, unguarded** — `schema.parse(await req.json())` for bodies,
   `schema.parse(Object.fromEntries(req.nextUrl.searchParams))` for query strings.
   A thrown `ZodError` is caught by the wrapper and becomes a 400. Dynamic-segment
   routes first do `const { id } = await params` (params is a Promise — Next 15).
3. **One service call** — `xService.method(db, audit?, ...)`. All business rules,
   audit writes, and DB access live in `src/server/services/*.ts`.
4. **Respond helpers by default** — `ok(data, { meta?, status? })` (200), `created(data)` (201).
   The deliberate exception is the authenticated XML download, which returns a raw
   `NextResponse` with `application/xml`, attachment, no-store and nosniff headers.

Variations seen in the codebase (all legitimate):
- Path-param merge: `lineItemCreateSchema.parse({ ...(await req.json()), invoiceId: id })`
  (`src/app/api/invoices/[id]/line-items/route.ts`).
- Optional body: `await req.json().catch(() => ({}))` then parse a schema whose fields
  have defaults (`src/app/api/shipments/[id]/artifacts/route.ts`).
- Route-local query schema extending `paginationQuery` when the filter set is trivial
  (`src/app/api/clients/route.ts`, `src/app/api/billing/invoices/route.ts`); shared
  ones (`shipmentListQuery`) live in `schemas.ts`.
- Auth routes (`login`, `register`) can't use `withAuth` (no session yet), so they are
  the ONLY routes with a manual `try { … } catch (error) { return fail(error) }`.

## Response envelope (`src/lib/api-response.ts`)

- Success: `{ data: T }`, plus `meta` at the top level only when provided:
  `{ data: [...], meta: { nextCursor, hasMore } }`. `ok()` defaults to 200; `created()` is 201.
- Failure: `{ error: { code, message, details? } }`. `fail(error)` maps, in priority order:
  1. **ZodError** → 400, `code: 'VALIDATION_ERROR'`, `message: 'Validation failed'`,
     `details: error.flatten().fieldErrors` (i.e. `{ fieldName: ["msg", ...] }`).
  2. **AppError subclass** → `error.status` / `error.code` / `error.message` / `error.details`:

     | Class | Status | Code |
     |---|---|---|
     | ValidationError | 400 | VALIDATION_ERROR |
     | UnauthorizedError | 401 | UNAUTHORIZED |
     | ForbiddenError | 403 | FORBIDDEN |
     | NotFoundError | 404 | NOT_FOUND (message: `"<Entity> not found"`) |
     | ConflictError | 409 | CONFLICT |
     | BusinessRuleError | 422 | BUSINESS_RULE_VIOLATION |

  3. **Anything else** → `console.error('[api] unhandled error:', …)` then 500
     `{ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }` —
     internals never leak to the client.
- Money is always a decimal **string** in JSON (`"13405.78"`), never a float.
- Auth: httpOnly session cookie (browser) or `Authorization: Bearer <jwt>` (API clients).
- `GET /api/customs-entries/:id/xml` is the only success-envelope exception: it returns
  the exact stored XML bytes as a private attachment. Errors still use the standard JSON envelope.

## Pagination contract (`src/lib/db/pagination.ts`)

- Cursor-based (id cursor), not offset. Query params via `paginationQuery` schema:
  `cursor?: string`, `limit?: number` (coerced, int, 1–100).
- Defaults/caps: `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`; `clampLimit()` enforces both.
- `cursorArgs(params)` fetches `limit + 1` rows (no COUNT query); `toPage(rows, params)`
  returns `{ items, hasMore, nextCursor }` where `nextCursor` is the last item's id or `null`.
- Routes surface it as `ok(page.items, { meta: { nextCursor: page.nextCursor, hasMore: page.hasMore } })` —
  every list route (shipments, clients, suppliers, manifests, billing/invoices) uses this
  exact shape. Repositories/services call `cursorArgs`/`toPage`; routes never do.

## Zod schema catalog (`src/lib/validation/schemas.ts`, Zod v3 — `^3.23.8`)

Shared primitives:
- `money` — string vs `/^\d{1,13}(\.\d{1,2})?$/` (positive, ≤2 dp). `moneyOptional` defaults `'0'`.
- `quantity` — string vs `/^\d{1,13}(\.\d{1,4})?$/` (≤4 dp).
- `RATE_REGEX` — fraction 0–1, ≤4 dp (used for `vatRate`, default `'0.10'`).
- `id` — `z.string().min(1)` (no cuid/uuid format check).
- `paginationQuery` — `{ cursor?, limit? }` with `z.coerce.number().int().min(1).max(100)`.

By resource (types exported via `z.infer<>`; field names mirror `prisma/schema.prisma`):

| Group | Schemas | Conventions |
|---|---|---|
| auth | `registerSchema`, `loginSchema` | email `.toLowerCase()`; password min 10 on register |
| clients/suppliers | `clientCreateSchema` / `clientUpdateSchema`; `supplierCreateSchema` / `supplierUpdateSchema` | update = `create.partial().extend({ isActive: z.boolean().optional() })`; country ISO alpha-2 `.toUpperCase()` |
| manifests | `manifestCreateSchema` / `manifestUpdateSchema` | update adds `status: OPEN\|CLOSED`; `z.coerce.date()` for dates |
| shipments | `shipmentCreateSchema` / `shipmentUpdateSchema` (plain `.partial()`), `shipmentStatusSchema`, `shipmentListQuery` | enums with `.default()`; `packageCount` coerced int; charges are `moneyOptional` |
| invoices/line items | `invoiceCreateSchema` / `invoiceUpdateSchema`; `lineItemCreateSchema` / `lineItemUpdateSchema` | ISO currency + BSD exchange rate; unitPrice 4 dp; full dotted HS; package/alcohol measurements |
| calculation/artifact | `calculateOptionsSchema`, `declarationArtifactSchema`, `declarationProfileUpdateSchema` | artifact type defaults C13; function code optional; profile captures TFP header/consignment fields |
| billing | `brokerageInvoiceCreateSchema` (nested `items` array, `.min(1)`), `paymentCreateSchema` | `vatRate` string fraction; payment `method` enum defaults BANK_TRANSFER |
| HS search | `hsCodeSearchQuery` | `q` 2–120 chars; limit capped at 50 (not 100) |

Conventions to copy: create/update pairs via `.partial()` (+ `.omit()` of the parent FK on
update); numeric query params via `z.coerce`; money/quantity/rate as validated strings;
dates via `z.coerce.date()`; enums carry `.default()` so minimal payloads work.

### HS-code format

Line-item entry requires the full internal national tariff shape
`/^\d{4}\.\d{2}\.\d{2}$/`. XML preflight repeats the check. Whether the accepted
Click2Clear wire value is dotted or undotted remains a government code-master dependency.

## Layering rules (verified by grep, 2026-07-08)

- **Routes are thin.** Zero occurrences of `prisma`, `getPrisma`, or `createTenantClient`
  in authenticated route files — routes only receive the tenant-scoped `db` from `withAuth`
  and pass it to services.
- **No try/catch in routes** except the two public auth routes (`login`, `register`) which
  must call `fail()` themselves because they sit outside `withAuth`.
- **Services** (`src/server/services/*.ts`: auth, billing, calculations, catalog,
  declaration-artifacts, hs-codes, invoices, shipments) own business rules (status machines,
  DRAFT-only edits, payment guards), audit writes (`writeAudit`), and throw typed
  `AppError` subclasses (`NotFoundError`, `BusinessRuleError`, `ConflictError`,
  `UnauthorizedError`) — never raw `Error` for expected failures.
- **Repositories** exist only for complex query shaping. `src/server/repositories/shipments.repository.ts`
  is the ONLY repository (verified); other services query the tenant client directly.
  Repos do `select`-not-`include`, cursor pagination, no business rules / HTTP / audit.

## Adding a new endpoint — checklist

1. **Schema** in `src/lib/validation/schemas.ts` (or route-local if a trivial list filter).
   Reuse `money`/`quantity`/`id`/`paginationQuery`; create/update pair via `.partial()`.
2. **Service function** in `src/server/services/` — takes `(db: TenantClient, audit?, input)`,
   enforces business rules with typed errors, calls `writeAudit` for every mutation.
   If the permission model needs a new string, add it to `Permission` + `MINIMUM_ROLE`
   in `src/lib/auth/rbac.ts` (coordinate via submit-auth-and-tenancy).
3. **Route file** at `src/app/api/.../route.ts`: `withAuth` + explicit `{ permission }`
   (read perm for GET, write perm for mutations — no exceptions), Zod parse, one service
   call, `ok`/`created`. No prisma, no try/catch, no hand-rolled JSON.
4. **List route?** Return `ok(page.items, { meta: { nextCursor, hasMore } })` backed by
   `cursorArgs`/`toPage`.
5. **Coverage**: extend `scripts/smoke.ts` (end-to-end workflow) and/or `tests/` as
   appropriate per submit-validation-and-qa.
6. **README**: update the "API surface" block and its count.

## Findings (updated 2026-08-08)

1. **Suppliers reuse `clients:read`/`clients:write`** — there is no `suppliers:*` permission
   in rbac.ts. Acceptable (same VIEWER/CLERK levels) but non-obvious; a reviewer expecting
   `suppliers:write` will not find it.
2. **`GET /api/auth/me` passes no permission** — intentional (any authenticated role may
   introspect itself), but it is the only `withAuth` route without one; note it so audits
   don't flag it repeatedly.
3. **HS lookup routes ignore tenant `db`** — global tariff reference data is deliberately unscoped.
4. **`GET /api/hs-codes/search` ignores the tenant `db`** — `hsCodesService.search(q, limit)`
   runs against global (non-tenant) HS reference data. Correct by design, but it is the one
   handler whose signature is `withAuth(async (req) => …)` with no context destructure.
5. **`GET /api/billing/invoices/:id` has no PATCH/DELETE/void sibling** — invoices can be
   created, sent, and paid but not voided via API despite a `VOID` status in the list filter
   enum. Gap, not a bug.

The XML download is the sole intentional non-JSON success response.

## Provenance and maintenance

- Route count: `find src/app/api -name route.ts | wc -l` (expect 29).
- Permission extraction: `grep -rn "permission:" src/app/api --include=route.ts` and
  `grep -rnE "export const (GET|POST|PATCH|PUT|DELETE)" src/app/api --include=route.ts`
  — re-run both and diff against the inventory table whenever routes change.
- Layering check: `grep -rn "prisma\|createTenantClient" src/app/api --include=route.ts`
  must return nothing.
