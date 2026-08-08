---
name: submit-auth-and-tenancy
description: >
  The security contract for Submit: auth flows (register/login/logout/me, JWT
  claims, cookie + Bearer transport), RBAC roles and permissions, and the
  3-layer tenant isolation model (Prisma extension, withAuth, Postgres RLS).
  Use when adding/modifying any API route or service that touches tenant data,
  when choosing a permission for a route, or when debugging symptoms like:
  cross-tenant data visible, 403 ForbiddenError, "why can a clerk not submit",
  deactivated/logged-out user still authenticated, RLS not blocking on local
  Postgres, findUnique returning another org's row, login/register 401/409
  behavior, or questions about basePrisma / systemQuery / $tenantTransaction.
---

# Submit — Auth and Tenancy (the security contract)

Dated 2026-07-08. Every claim below was verified against the code on this date.

Submit is a multi-tenant SaaS for Bahamian customs brokerages. Tenant = an
`Organization`. Every request is scoped to exactly one org, derived from a
verified JWT — never from request input. This skill is the contract you must
not break when adding endpoints, services, or queries.

## When NOT to use this skill

- **Adding a new tenant-scoped model** (schema + `TENANT_MODELS` + `rls.sql`
  mechanics) → `submit-schema-and-migrations` owns the three-place-update
  procedure. This skill only tells you the invariant exists.
- **Route handler structure, Zod validation, response envelope** →
  `submit-api-conventions`.
- Layering rules, money math, BEAIP, env/build → `submit-architecture-contract`,
  `submit-calculations-and-money`, `submit-beaip-integration-campaign`,
  `submit-build-and-env`.

## Module reference

| Module | Path | Exports / role |
|---|---|---|
| JWT | `src/lib/auth/jwt.ts` | `SessionClaims`, `signSession`, `verifySession`. HS256, issuer `submit`, TTL from `SESSION_TTL_SECONDS` |
| Passwords | `src/lib/auth/password.ts` | `hashPassword`/`verifyPassword`, bcryptjs cost **12** (~250ms; pure JS, no native build) |
| RBAC | `src/lib/auth/rbac.ts` | `ROLE_LEVEL`, `Permission`, `MINIMUM_ROLE`, `hasPermission`, `requirePermission` (throws `ForbiddenError` 403) |
| Cookie | `src/lib/auth/session-cookie.ts` | `SESSION_COOKIE = 'submit_session'`; httpOnly, Secure (prod), SameSite=Lax, path `/`, maxAge = TTL |
| **Chokepoint** | `src/lib/auth/with-auth.ts` | `withAuth(handler, { permission? })` — token extraction, claim verification, permission check, tenant client construction |
| Tenant client | `src/lib/db/tenant-client.ts` | `createTenantClient(orgId)`, `TENANT_MODELS`, `$tenantTransaction` — isolation layer 1 |
| Base client | `src/lib/db/prisma.ts` | `basePrisma` (unscoped — restricted, see escape hatches), `systemQuery` (RLS bypass for pre-auth) |
| RLS | `prisma/sql/rls.sql` | isolation layer 3: FORCE RLS + `tenant_isolation` policies + `system_bypass` |
| Auth service | `src/server/services/auth.service.ts` | `register`/`login`/`me` flows (the ONLY module using `systemQuery`) |
| Errors | `src/lib/errors.ts` | `UnauthorizedError` 401, `ForbiddenError` 403, `ConflictError` 409, etc. |
| Env | `src/lib/env.ts` | `JWT_SECRET` (min 16 chars), `SESSION_TTL_SECONDS` default 43200 (12h) |
| Executable spec | `tests/tenant-isolation.test.ts` | 5 live tests proving layer 1 against real Postgres |

## Auth flow runbook

### Register — `POST /api/auth/register` (public)

1. Route parses `registerSchema`, calls `authService.register`.
2. Inside `systemQuery` (RLS bypass — no org context exists yet):
   duplicate-email check, org slug generation (collision → time-suffix),
   then Organization + OWNER user created **atomically** in one transaction.
3. First user of a new org is always role `OWNER`.
4. `signSession` issues the JWT; route sets the `submit_session` cookie;
   returns 201 with `{ user }` (token also in `AuthResult` for API clients).
5. **Duplicate email → `ConflictError` 409 "An account with this email already
   exists."** Because `User.email` is globally unique (`@unique`, schema line
   83), this is a cross-tenant account-enumeration surface: register reveals
   whether an email exists anywhere in the system, even though login is
   deliberately uniform ("Invalid email or password" for all failures).

### Login — `POST /api/auth/login` (public)

1. `systemQuery` → `user.findUnique({ where: { email } })` with org include.
2. Rejects with the SAME 401 message for: no user, inactive user, inactive
   org, wrong password (no enumeration via login).
3. Updates `lastLoginAt`, signs JWT, sets cookie, returns `{ user }`.

### JWT claims (exact payload, `SessionClaims` in jwt.ts)

```
{ sub: userId, orgId: organizationId, role: UserRole, email: string }
```

Signed HS256 with `JWT_SECRET`, `issuer: 'submit'`, `expiresIn:
SESSION_TTL_SECONDS` (default 43200 s = 12 h). `verifySession` rejects any
token missing `sub`/`orgId`/`role` and maps every failure to
`UnauthorizedError` 401. **`orgId` from this token is the sole source of
tenant scope for the entire request.**

### Transport — cookie AND Bearer

`extractToken` in with-auth.ts checks, in order:

1. `Authorization: Bearer <token>` header (API clients) — **wins if present**
2. `submit_session` httpOnly cookie (browser)

### withAuth verification (every protected route)

```
export const POST = withAuth(handler, { permission: 'shipments:write' })
```

Order of operations: extract token → `verifySession` → `requirePermission`
(if the `permission` option is set) → `createTenantClient(claims.orgId)` →
handler receives `{ claims, db, audit, params }`. Any throw is mapped by
`fail()` (401/403/etc.). Handlers **never** receive an unscoped client.

**Public exceptions are exactly three routes:** `/api/auth/login`,
`/api/auth/register`, `/api/auth/logout`. Everything else, including
`/api/auth/me`, goes through `withAuth`.

### Logout — `POST /api/auth/logout` (public)

**Logout is ONLY cookie clearing.** The route calls `clearSessionCookie()`
and returns `{ loggedOut: true }`. There is no session store, no token
blocklist, no revocation of any kind (verified: no server-side session state
exists anywhere in `src/`). A JWT captured before logout — or held by a
Bearer client — remains valid until it expires (≤ 12 h).

### Me — `GET /api/auth/me` (withAuth, no permission option)

`authService.me` re-reads the user via `systemQuery` and throws 401 if
`!user.isActive`. This is the ONLY authenticated path that re-checks
`isActive` — see security posture below.

## RBAC

### Role ladder (`ROLE_LEVEL`, rbac.ts)

```
VIEWER (0) < CLERK (1) < BROKER (2) < ADMIN (3) < OWNER (4)
```

A check passes when the user's level ≥ the permission's minimum level.

### Permission catalog (`MINIMUM_ROLE`, verbatim from rbac.ts)

| Permission | Minimum role |
|---|---|
| `shipments:read` | VIEWER |
| `shipments:write` | CLERK |
| `shipments:submit` | **BROKER** |
| `billing:read` | CLERK |
| `billing:write` | BROKER |
| `clients:read` | VIEWER |
| `clients:write` | CLERK |
| `users:manage` | ADMIN |
| `organization:manage` | OWNER |

**The reserved filing rule: `shipments:submit` requires BROKER+.** Clerks may
prepare shipments and generate review XML under `shipments:write`; no direct
Customs submission route currently exists. When an endpoint is verified, the
BROKER+ boundary must be restored at its route and must not be relaxed.

### Where checks happen (verified 2026-07-08)

Permission checks live **exclusively at the route layer**, passed as the
`withAuth` options argument. A repo-wide grep confirms `requirePermission` is
called in exactly one place — with-auth.ts line 56 — and **no service ever
performs a permission check**. Do not add checks inside services, and do not
go hunting there when debugging a 403: the answer is always the route file's
`{ permission: ... }` option plus the table above. Failure surfaces as
`ForbiddenError` → 403 with message `Your role (ROLE) cannot perform
PERMISSION`.

## Tenant isolation — the 3-layer model

```
 Request (cookie or Bearer)
        │
        ▼
 ┌─────────────────────────────────────────────┐
 │ Layer 2 — withAuth (with-auth.ts)           │  verify JWT → orgId
 │ builds createTenantClient(claims.orgId);    │  handlers never see an
 │ orgId ONLY from the verified token          │  unscoped client
 └───────────────────┬─────────────────────────┘
                     ▼
 ┌─────────────────────────────────────────────┐
 │ Layer 1 — Prisma extension (PRIMARY,        │  injects organizationId
 │ tenant-client.ts)                           │  into every op on the 12
 │ where-injection + create-stamping           │  TENANT_MODELS
 └───────────────────┬─────────────────────────┘
                     ▼
 ┌─────────────────────────────────────────────┐
 │ Layer 3 — Postgres RLS (BACKSTOP, rls.sql)  │  FORCE RLS + policies on
 │ set_config('app.current_org_id', $org, true)│  organizationId; catches
 │ transaction-scoped, PgBouncer-safe          │  any bug in layers 1–2
 └─────────────────────────────────────────────┘
```

### Layer 1 — Prisma extension (primary enforcement)

`createTenantClient(orgId)` extends `basePrisma` so that for every model in
`TENANT_MODELS` — `User, Client, Supplier, Manifest, Shipment,
ShipmentDocument, Invoice, LineItem, CustomsEntry, BrokerageInvoice, Payment,
AuditLog` (12 models) —

- **where-injection** on `findFirst(OrThrow)`, `findMany`,
  **`findUnique(OrThrow)`** (Prisma 5+ extendedWhereUnique makes this legal),
  `update(Many)`, `delete(Many)`, `count`, `aggregate`, `groupBy`;
- **create-stamping** of `organizationId` into `data` (incl. array form) on
  `create`, `createMany`, `createManyAndReturn`, `upsert` — and `upsert`
  additionally gets where-injection.

Each behavior is proven live by `tests/tenant-isolation.test.ts`:
scoped `findMany` despite identical shipmentNumbers in two orgs (test 1),
`findUnique` by a foreign org's id returns null (test 2), creates auto-stamped
(test 3), cross-tenant `update` by id throws — no row in scope (test 4),
`count` scoped below the global count (test 5). Treat these tests as the
executable spec: any change to tenant-client.ts must keep all five green.

Every operation is also wrapped in a **batch `$transaction([set_config,
query])`** so the RLS variable and the query share one pooled connection
(layer 3 wiring).

### Layer 2 — withAuth (request layer)

The only path from HTTP to data. Handlers receive a `TenantClient` already
locked to `claims.orgId`; there is no API to widen it. `orgId` comes from a
cryptographically verified token — never from a body, query param, or header
you can spoof.

### Layer 3 — RLS (database backstop)

`prisma/sql/rls.sql` (applied via `npm run db:rls`): `tenant_isolation`
policies (`USING` + `WITH CHECK` on `organizationId =
current_setting('app.current_org_id', true)`) on all 12 tenant tables, with
`FORCE ROW LEVEL SECURITY` because Neon's `neondb_owner` owns the tables and
owners otherwise bypass RLS. Special cases:

- `BrokerageInvoiceItem` has no `organizationId` — scoped via `EXISTS`
  subquery through its parent `BrokerageInvoice`.
- `Organization` — a tenant sees only its own row (`id = current_org_id`).
- `system_bypass` policies on `User`, `Organization`, `AuditLog` only, gated
  on `app.bypass_rls = 'on'` — this is what `systemQuery` sets, for pre-auth
  flows.
- `set_config(..., true)` is transaction-scoped: mandatory under Neon's
  PgBouncer transaction pooling (session-level SET would leak across
  requests). Unset context → `current_setting(..., true)` returns NULL →
  zero rows, not an error.

**Superuser caveat:** on local dev Postgres the role is typically a
superuser, and superusers BYPASS RLS entirely — so "RLS not blocking on
local Postgres" is expected, not a bug. Layer 1 still enforces isolation
locally (that is exactly what the 5 integration tests prove). RLS is real on
Neon, where `neondb_owner` is not a superuser.

## Escape hatches and their rules

| Hatch | Legal in | Rule |
|---|---|---|
| `basePrisma` (unscoped client) | `src/lib/db/prisma.ts`, `src/lib/db/tenant-client.ts`, `src/server/services/hs-codes.service.ts` — these three files ONLY (verified by grep 2026-07-08) | Only for global reference data (HSCode, Port, CustomsOffice, Carrier, Vessel, Voyage, Journey, ShippingAgent, HSCodeRate — intentionally unscoped). Never for anything in TENANT_MODELS from request code. |
| `systemQuery` (`app.bypass_rls`) | `src/server/services/auth.service.ts` ONLY (verified) | Pre-auth flows that necessarily run before an org context exists: register, login, me. The bypass policies only cover User/Organization/AuditLog anyway. Do not add new callers without a security review. |
| `db.$tenantTransaction(fn)` | Any service holding a TenantClient | Multi-write atomicity (e.g., calculation persist, payment + balance update). Opens ONE interactive transaction, sets the RLS var first, hands you a raw tx client. Inside it, RLS is the enforcement layer — only write by ids you fetched through scoped reads. |

## Tenancy invariants — checklist for new endpoints/services

- [ ] Route wrapped in `withAuth`, with an explicit `{ permission }` chosen
      from the catalog above (only `/api/auth/me` legitimately omits it).
- [ ] **Never accept `organizationId` from request input** — not in body,
      query, params, or headers. The tenant client stamps it; a client-supplied
      value must be ignored or rejected by the Zod schema.
- [ ] All tenant data access via `ctx.db` (the TenantClient). No `basePrisma`
      import outside the three legal files; no new `systemQuery` callers.
- [ ] Multi-write operations that must commit together → `$tenantTransaction`,
      writing only by ids obtained from scoped reads.
- [ ] Do not "optimize away" the extension by using `$queryRaw` on tenant
      tables from request code — raw SQL skips layer 1 (RLS still applies on
      Neon, but not on local superuser Postgres, so tests will not catch you).
- [ ] New tenant-scoped model = **three-place update**: Prisma schema (with
      `organizationId` column) + `TENANT_MODELS` in tenant-client.ts +
      `rls.sql` policy. Miss one and you have a silent leak. Mechanics live in
      `submit-schema-and-migrations` — go there before touching the schema.
- [ ] Cross-tenant leak smells in review: `findUnique` by a client-supplied id
      on a non-TENANT_MODELS table that should be scoped; joins/includes that
      traverse from a global model into tenant data; returning counts or
      existence checks computed on `basePrisma`.

## Security posture notes (verified 2026-07-08)

- **No rate limiting anywhere.** No limiter on login/register or any route
  (repo-wide grep: zero hits outside node_modules). Credential stuffing and
  bcrypt-cost CPU exhaustion on `/api/auth/login` are unmitigated.
- **Stateless sessions, no revocation.** 12 h JWT TTL
  (`SESSION_TTL_SECONDS` default 43200); no session store exists. Logout only
  deletes the browser cookie — the token itself stays valid until expiry.
  Deactivating a user (`isActive = false`) does NOT cut off an existing
  session: only `login` and `/api/auth/me` check `isActive`; every other
  route trusts the JWT alone. A deactivated user with a live token keeps full
  role-based access for up to 12 h. Same for role demotions: the `role` claim
  is frozen at sign time.
- **Register-side enumeration.** `User.email` is globally unique; register
  returns 409 with an explicit "already exists" message, so anyone can probe
  which emails have accounts across all tenants (login is uniform, register
  is not).
- **bcryptjs cost 12** (~250 ms/hash) — pure-JS, Vercel-serverless-safe.
- **JWT_SECRET** minimum is only 16 characters (env.ts) — short for HS256;
  use a long random value in production. Never print or log its value.
- **Credential rotation warning (from README):** the Neon connection string
  used during development was shared in a chat session while building this
  project — rotate the Neon password before/at deploy. Also set a fresh
  `JWT_SECRET` on Vercel.

## Provenance and maintenance

- Ground truth: `src/lib/auth/*` (jwt, password, rbac, session-cookie,
  with-auth), `src/lib/db/{prisma,tenant-client}.ts`, `prisma/sql/rls.sql`,
  `src/server/services/auth.service.ts`, `src/app/api/auth/*/route.ts`,
  `src/lib/{env,errors}.ts`, `tests/tenant-isolation.test.ts`, README
  (Tenant isolation / RBAC sections). All read directly on 2026-07-08.
- Re-verify after any change to: with-auth.ts (chokepoint), TENANT_MODELS,
  rls.sql, MINIMUM_ROLE, session/TTL handling, or the auth routes list.
- If the 5 tests in `tests/tenant-isolation.test.ts` change, update the
  Layer 1 section — they are the executable spec this skill cites.
