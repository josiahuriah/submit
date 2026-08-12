# Frontend Integration — Session Handoff

> Historical record: this describes the state at commit `b72bc45`. Its
> unfinished-work list was superseded on 2026-08-08 by the operational `/home`,
> client/supplier CRUD, manifest/shipment editing, billing/accounting screens,
> ESLint configuration, and the fresh-account route workflow test. Use
> `README.md` and the `.agents/skills/` runbooks for current status.

Written 2026-07-29, at commit `b72bc45` (the repo's first commit).

Context for whoever picks this up next. The `.claude/skills/` library is the
authority on how the system *works* (architecture, tenancy, money math, API
conventions, domain terms) — **read those first and don't duplicate them here**.
This file covers only what that library can't: what this integration session
changed, the decisions behind it, the traps that cost real time, and what is
still unfinished.

---

## 1. Where things stand

The TypeScript frontend and the existing backend are integrated, building, and
running against a local Postgres dev database. Everything below is verified, not
assumed.

| Gate | State |
|---|---|
| `npm run build` | clean |
| `npx tsc --noEmit` | zero errors |
| `npm test` | 26/26 (11 calculations, 5 tenant isolation, 10 tariff import) |
| `npm run lint` | **no ESLint config exists** — the command prompts to create one |
| Migrations | 3, in sync, zero drift |

**Repo location moved this session.** The working backend was at
`~/Downloads/submit`; it is now `~/Documents/Documents/Development/Submit/submit`
and is the canonical repo (`git init` + first commit made here). A *different,
older* project — Next 16, billing-only, its own git history — was displaced to
`../submit-legacy/` and is **not** part of this work. Ignore it.

Also in the parent directory: `../schema.prisma` and `../seed.ts` are **stale
v2.0.0 snapshots**. The live schema is **v2.1.0** and is strictly newer. Do not
copy those over anything.

---

## 2. Getting a working environment

```bash
createdb -h localhost submit_dev
# .env: DATABASE_URL + DIRECT_URL -> submit_dev, JWT_SECRET >= 16 chars,
#       SHADOW_DATABASE_URL -> submit_shadow
npx prisma migrate deploy
npm run db:rls          # RLS policies only — see §5
npm run db:seed         # reference data
npm run db:seed:dev     # two tenants + demo shipment
```

`.env` is gitignored and holds a locally generated `JWT_SECRET`. The dev seed
prints its own login credentials; `broker@bahamabrokerage.test` is the useful
one (BROKER can submit; CLERK cannot; a VIEWER exists for RBAC checks).

`submit_shadow` is a scratch database the migration engine creates and drops.
It must exist for `migrate dev` / `migrate diff` to run.

---

## 3. What was built

### The data seam
`src/lib/data/*` is the **only** place UI meets backend. Pages never touch
services, repositories or `fetch()`. Both files pull `organizationId` from the
verified session and go through `createTenantClient()`, so every read is
org-scoped by construction.

- `shipments.ts` — `listShipments`, `getShipment`. Mappers reconcile every
  field-name difference (`client.name`→consignee, `manifest.voyage.arrivalDate`
  →arrival, `createdBy`→"D. Smith", multi-supplier→"Various"). **Fix mismatches
  in the mappers, never in components.**
- `line-items.ts` — reads plus two Server Actions (`commitLineItem`,
  `deleteLineItem`). Actions are POST endpoints in their own right, so they
  re-assert everything `withAuth` gives routes: verified session,
  `requirePermission('shipments:write')`, tenant client, audit context.

### Auth for pages
`src/lib/auth/session.ts` (`getSession` / `requireSession`) is the
Server-Component counterpart to `withAuth`. Same cookie, same JWT; it redirects
instead of returning a response. `(app)/layout.tsx` guards the whole route group.

### Supporting changes
`prisma/tariff-import.ts` (+ its tests), `prisma.config.ts` (datasource +
shadow URL), `prisma/migrations/migration_lock.toml`, extended `LIST_SELECT` /
`LINE_SELECT`, typed `hsCodesService.search`.

---

## 4. Money rules that are easy to break

**The charges ledger must read shipment roll-ups, never a sum of lines.**
The processing fee is charged at shipment level and VAT applies to the fee
itself, so it belongs to no line. Summing line amounts under-reports the total —
it was off by exactly $21.28 (10% of a $212.80 fee) before this was fixed.
`ShipmentTotals` carries the engine's own `totalVat` / `totalPayable`. The table
*footer* still sums lines, correctly, because those columns are line totals. Both
sites are commented; don't "unify" them.

**The client preview is not authoritative.** `src/lib/calc.ts` prices the entry
row only, so typing feels instant. It cannot do SPECIFIC or COMPOUND duty bases —
a whisky line previews as $0.00 duty and the server returns $144.00. Committing
creates the line *and* reprices via the real engine, and the returned numbers
replace anything shown optimistically. Never persist or display a preview as fact.

**Money crosses as strings.** `ServerLineCharges` and `ShipmentTotals` are all
strings. Where the UI must sum for display, it does so in integer cents.

**`charges: null` means "not yet calculated"**, not zero. Creating a line clears
`calculatedAt`; the UI shows "not yet calculated" rather than inventing numbers.

---

## 5. Traps discovered the hard way

**Server Actions redact thrown errors in production builds.** A `BusinessRuleError`
thrown across the action boundary reaches the user as *"An error occurred in the
Server Components render"* with no cause. Expected, explainable failures must be
returned as **data** (`CommitLineResult.error`), not thrown. Only genuinely
unexpected errors should throw.

**`prisma migrate dev` used to demand a full database reset**, because the
pg_trgm GIN indexes were applied out-of-band by `apply-rls.ts` and read as
schema drift. **Fixed** — but note *how*, because the obvious fix is wrong:

- Moving `indexes.sql` verbatim into a migration made `migrate dev` start
  generating `DROP INDEX` for all six. The indexes were in history but not in
  the datamodel, so Prisma treated them as strays. That is *worse* — a silent
  deletion instead of a loud refusable prompt.
- The correct fix: **Prisma can express trigram GIN indexes.** They are now
  declared in `schema.prisma` as
  `@@index([col(ops: raw("gin_trgm_ops"))], type: Gin, map: "<existing_name>")`,
  with `previewFeatures = ["postgresqlExtensions"]` and
  `extensions = [pg_trgm]`. `map:` pins the existing `*_trgm_idx` names so
  nothing is dropped and recreated. `migrate dev` now yields an empty migration.
- `prisma/sql/indexes.sql` is **deleted**. `db:rls` applies only `rls.sql`.
  **A new fuzzy-searched text column gets its index declared in the schema** —
  putting it anywhere else reintroduces the drift.
- RLS stays out-of-band deliberately: Prisma doesn't model policies, so it
  causes no drift — and it still vanishes on any reset until `db:rls` reruns.

**`prisma db execute` can fail silently while `migrate resolve` still records
the migration as applied.** That combination left history claiming a column
existed when it did not. Always verify against `information_schema` after a
manual apply. `migrate resolve` records intent, not outcome.

**`prisma migrate dev` cannot be used normally on a database with data** given
this repo's history. The safe pattern used here: `migrate diff --from-migrations
--to-schema --script` → hand-place the SQL in a migration folder → apply with
`psql` → `migrate resolve --applied` → verify the column/index actually exists.

---

## 6. The tariff data

`prisma/data/hs-codes.json` is a 1,544-code extraction of the 2023 Bahamas
Tariff Schedule. It is **duty-rate-only** and cannot be loaded naively —
`prisma/tariff-import.ts` normalizes it and documents each decision in its
header. Four things matter:

1. **Code format** — the file writes `2208.3000`; this system and the BEAIP
   validator require `2208.30.00`. Unconverted, all 1,544 codes fail at filing.
2. **`specificRate` is discarded** — the column only ever holds `'300%'` or
   `'None'`. As a BSD-per-unit rate that means $300/lb of beef. It is an
   artifact; every imported line is AD_VALOREM.
3. **43 curated lines are never overwritten** — they carry hand-verified
   SPECIFIC/COMPOUND rates (vodka $12.00/L, cigarettes compound, fuel). The
   extraction has duty 0 and no excise for those same codes; importing them
   would zero out duty on exactly the goods this product prices most carefully.
   The guard set is derived from `HS_SUBSET` itself so it can't drift.
4. **VAT/levy/excise fall back to defaults** because the file has no such
   columns — see the open gap below.

Two guards protect future imports: `assertDutyColumnsAgree` halts if the file's
decimal and human duty columns disagree, and `normalizeCode` throws on an
unrecognized shape rather than guessing. Next tariff year should be a file swap
plus a `TARIFF_EDITION` bump. `tests/tariff-import.test.ts` pins all of it.

---

## 7. Open gaps, roughly by importance

1. **132 HS codes in chapters 22 and 87 carry no excise data** (VAT 10%, excise
   0, levy 0). A broker selecting an imported spirits or vehicle line gets
   understated duty. The seed prints a warning every run so it stays visible.
   Closing it needs a source with excise columns. **This is the one with money
   consequences.**
2. **Rotate the Neon credential.** A live `neondb_owner` connection string was
   pasted into a chat session (twice, across sessions). It is not in this repo —
   the app runs on local Postgres — but treat it as compromised.
3. **Home, Manifests, Clients, Billing, Accounting are scaffolds.** They render
   the shell and a placeholder note. Suggested build order per the frontend
   README: Manifests → Clients → Billing → Accounting → Home. Each is a
   variation of the two implemented patterns (list page, interactive page).
4. **Submit buttons are unwired.** "Save draft", "Submit to customs" and the
   ledger's "Submit declaration" are scaffold markup and stay active even on a
   submitted shipment. The API path behind them works
   (`POST /api/shipments/[id]/submit`, mock BEAIP, RBAC-gated to BROKER).
5. **`commitLineItem` uses the shipment's first invoice.** Multi-invoice
   shipments need a picker.
6. **Repricing runs a full shipment calculation on every line commit.** Correct,
   but O(lines) per commit.
7. **No ESLint config** and **no CI**. Nothing forces the suite to run.
8. **No HTTP-layer tests** — route handlers are untested end-to-end.
9. **`/dashboard`** (the old client-fetch page) still exists beside the new
   `(app)` group. `/` sends authenticated users to `/home`.
10. **CPC has no authoritative code list.** `LineItem.cpcCode` (added this
    session, default `"4000"`) is validated for shape only
    (`^[0-9A-Z-]{3,10}$`); an unknown-but-well-formed code is accepted and would
    surface at submission. Distinct from `CustomsEntry.declarationType`
    (C13/C14/…), which classifies the whole declaration.

---

## 8. Verifying a change

```bash
npm run build && npx tsc --noEmit && npm test
```

For anything touching the seam, tenancy, or money, also walk it in a browser —
several bugs this session (the ledger shortfall, the redacted action error)
were invisible to the type checker and the test suite.

Isolation checks that should always hold: org2 opening org1's shipment gets
**404** with nothing leaked; anonymous hits `/login`; VIEWER gets `FORBIDDEN` on
write; CLERK cannot submit. Both seeded orgs legitimately have a shipment
numbered `SHP-2026-00001` — that is per-org numbering, not a leak.

If you mutate dev data while testing, restore it: `npm run db:seed:dev` does
**not** reset an already-submitted shipment's status, so reset status, totals and
`calculatedAt` explicitly and delete any `CustomsEntry` rows you created.
