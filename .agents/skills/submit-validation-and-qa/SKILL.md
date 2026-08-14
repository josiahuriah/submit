---
name: submit-validation-and-qa
description: >
  How to verify a change in the Submit codebase: write/run tests, add a
  regression case, decide what evidence is required before a change is
  accepted, run the e2e smoke test, and know the honest coverage gaps.
  Use when asked "how do I test this", "did my change break anything",
  "what proves this is correct", "add a test for X", "run the smoke test",
  or "what is NOT covered by tests".
---

# Submit — Validation & QA runbook

This skill defines what counts as **evidence** in this repo, the exact
verification commands per change type, and the honest gaps (updated 2026-08-14).

**When NOT to use this skill:**
- Money/duty math recipes and worked examples → `submit-calculations-and-money`
- Getting the DB/env into a state where tests can run at all (DATABASE_URL, seeds, `db:setup`) → `submit-build-and-env`
- Whether a change is *allowed* and how it must be gated/reviewed → `submit-change-control`
- Schema/migration verification specifics → `submit-schema-and-migrations`
- Auth/tenancy design → `submit-auth-and-tenancy`; BEAIP protocol work → `submit-beaip-integration-campaign`; API shape → `submit-api-conventions`; system layering → `submit-architecture-contract`; customs domain facts → `bahamas-customs-reference`

---

## 1. Evidence standards

This project's own bar is high: a **pure deterministic calculation engine**,
an **executable spec** in `tests/calculations.test.ts`, **live-database
isolation proofs** in `tests/tenant-isolation.test.ts`, and an **end-to-end
smoke script**. Match that bar.

| Claim | Acceptable evidence | NOT evidence |
|---|---|---|
| "The math is right" | A failing-then-passing vitest case with **hand-computed** expected values, or machine-checked numbers (smoke script / verify-example script) | Eyeballing UI output; "the engine returned X so I'll assert X" |
| "Tenancy is intact" | `tests/tenant-isolation.test.ts` green against a live seeded DB | Code review of the Prisma extension alone |
| "The whole flow works" | `tests/fresh-account-workflow.test.ts` and `npx tsx scripts/smoke.ts` both exit 0 | Clicking through the UI once |
| "The code is valid" | `npm run typecheck` + `npm run lint` clean | "It compiles" is *necessary*, never *sufficient* |

Hard rules:
- **"It compiles" and "looks right" are not evidence.** Typecheck/lint are
  gatekeepers, not proof of behaviour.
- **Any change touching money requires a failing-then-passing test** (write
  the test, watch it fail against the old behaviour or intentionally-wrong
  expectation, then pass) **or** machine-checked numbers you derived by hand.
- **Never copy engine output into a test as the expectation.** Every existing
  test hand-computes its numbers in comments (e.g. `// Duty = 1200 × 0.45 = 540`).
  A test that asserts whatever the code produced certifies nothing.

## 2. Verification inventory

| Command | What it proves | Expected outcome | Environment needs |
|---|---|---|---|
| `npm test` | Full pure + live-DB suite | 60 tests across 11 files pass | Tenant isolation and fresh-account workflow need a live seeded `DATABASE_URL`; pure tariff/calculation/TFP/XML tests do not. |
| `npx vitest run tests/calculations.test.ts` | Calculation and alcohol measurement engine | 16 passed | **No DB needed.** Safe anywhere. |
| `npx vitest run tests/tenant-isolation.test.ts` | Layer-1 tenant scoping (Prisma extension) against real Postgres | 5 passed | Live seeded DB. Creates then deletes a `ISOLATION-TEST-CLIENT` client row (cleanup in `afterAll`). |
| `npx vitest run tests/fresh-account-workflow.test.ts` | Route-handler workflow: register → client → supplier → manifest → shipment → invoice → line → calculation → review XML, then billing send/payment | 1 passed | Live DB with global reference seed. Creates and deletes a uniquely named tenant. |
| `npx tsx scripts/smoke.ts` | E2E: calculate → math checks → versioned review XML; shipment stays DRAFT | Exits 0, prints "Smoke passed" | Live seeded local DB. **MUTATES demo data** — see warning below. |
| `npm run typecheck` (`tsc --noEmit`) | Types are sound across the whole repo | No output, exit 0 | None |
| `npm run lint` (`eslint .`) | ESLint 9 + Next core-web-vitals and TypeScript rules | No errors | None |
| `npx tsx .Codex/skills/submit-calculations-and-money/scripts/verify-example.ts` | The sibling skill's worked example matches the real engine (18 asserted values) | Exit 0 | No DB. Run from repo root. |
| `npm run test:watch` | Same as `npm test`, watch mode for TDD loops | interactive | Same as `npm test` |

Test infra facts (`vitest.config.ts`, `tests/setup.ts`): node environment,
`tests/**/*.test.ts` glob, 30s test **and** hook timeouts (DB tests need it),
`@` → `src/` alias, and setup loads `.env` via `dotenv/config` (Next.js does
this at runtime; vitest doesn't, so DB tests would silently miss
`DATABASE_URL` without it).

### smoke.ts — exactly what it touches (read before running)

For org `bahama-brokerage`, shipment `SHP-2026-00001`:
1. **Deletes all `CustomsEntry` rows** for that shipment and resets it to
   `DRAFT` (`submittedAt: null`, `calculatedAt: null`) so it is re-runnable.
2. Calculates with `apportionmentBasis: 'VALUE'` and hard-asserts:
   - line 1 (rum) `exciseAmount === '1716.00'` (600 L × 0.22 × $13/imperial gallon)
   - `totalCifValue − totalFobValue === '2315.00'` (freight 1850 + insurance 320 + other 145, apportioned to the penny)
3. Generates a `C13` TFP review artifact and records the exact XML.
4. Asserts shipment status remains `DRAFT` and `submittedAt` remains null.

It uses `basePrisma` (tenant-bypassing) for the reset steps. Do not point it
at production data; the delete in step 1 is unconditional.

## 3. Per-change-type runbooks

### Touched `src/lib/calculations/**` (money math)
1. `npx vitest run tests/calculations.test.ts` — must pass first (baseline).
2. **Add a regression test** in `tests/calculations.test.ts` mirroring the
   existing style (see §4). Hand-compute the expectation. Watch it fail, then pass.
3. `npx tsx scripts/smoke.ts` (seeded DB) — the 1716.00 / 2315.00 spot checks
   must still hold.
4. `npx tsx .Codex/skills/submit-calculations-and-money/scripts/verify-example.ts`
   — if this fails, either your change is wrong or the sibling SKILL.md
   worked example is now stale; resolve explicitly, never silently.
5. `npm run typecheck && npm run lint`.

### Touched tenancy/auth (`src/lib/db/tenant-client.ts`, `prisma/apply-rls.ts`, auth service)
1. `npx vitest run tests/tenant-isolation.test.ts` against the seeded dev DB — all 5 must pass.
2. Manual cross-org probe (in addition, not instead):
   - Log in as a user of org A, note a shipment id belonging to org B
     (query via `basePrisma` or the other org's login).
   - Fetch/update that id through org A's session. Expect null/404/throw.
   - Repeat for at least one `update` and one `findUnique` — those are the
     historically dangerous paths (extendedWhereUnique injection).
3. Remember: these tests prove **Layer 1 only**. The RLS backstop (Layer 3)
   is unverifiable on local Postgres (superuser bypasses RLS). Do not read a
   green run as "RLS works".
4. Full `npm test` + typecheck.

### Touched `prisma/schema.prisma` or migrations
1. Follow `submit-schema-and-migrations` first — it owns the migration procedure.
2. Then rerun the **full** suite (`npm test`) and `npx tsx scripts/smoke.ts`
   on a freshly `db:setup` database, plus `npm run typecheck` (Prisma client
   types shift with the schema).

### Touched TFP XML (`src/lib/beaip/**`, mapper/artifact service)
1. Run `tests/wco-xml.test.ts` (`xmllint` validates against the supplied XSD when available).
2. Run `tests/tfp-field-mapping.test.ts` for mandatory-field preflight.
3. Run `scripts/smoke.ts` on seeded local Postgres and confirm it never changes
   shipment status or calls an endpoint.
4. Know the limit: the permissive common-types stub cannot prove withheld
   enumerations/length rules or Click2Clear business validation.

### Touched routes / request validation (`src/app/api/**`, zod schemas)
1. `npm run typecheck` — the primary machine check here.
2. Run whichever service-level tests exist for the logic behind the route
   (calculations → engine tests; anything touching tenant data → isolation tests).
3. Run `tests/fresh-account-workflow.test.ts` when the supported declaration
   path is affected. It invokes real route handlers and asserts their success
   statuses/envelopes. Error branches, malformed requests, and most individual
   CRUD endpoints still require targeted tests or manual probing.

## 4. Test-writing conventions (mined from the existing suite)

- **Location/naming:** `tests/<area>.test.ts`, picked up by the
  `tests/**/*.test.ts` glob. Import from `@/...` (alias to `src/`).
- **Money assertions:** the calc suite defines
  `const eq = (a: Decimal, b: string) => expect(a.toFixed(2)).toBe(b)` and
  asserts against **string** money at 2dp. Do the same; never compare floats.
- **Hand-computed expectations:** every expected value carries its derivation
  in a comment (`// CIF = 1000 + 150 + 30 + 20 = 1200`,
  `// 1% of 700 = 7 → clamped up to $10 minimum`). New tests must show the
  arithmetic. Copying engine output as the expectation is prohibited (§1).
- **Descriptive `it` names state the property**, not the input: "sums exactly
  to the charge even with awkward thirds", "caps the processing fee at $750".
- **DB tests:** guard in `beforeAll` with a clear error if seeds are missing
  (see tenant test's "Dev seed missing" throw); clean up everything you
  create in `afterAll` using a distinctive marker name (the existing pattern
  is `ISOLATION-TEST-CLIENT`); always `basePrisma.$disconnect()` in `afterAll`.
- **Document scope honestly** in a header comment: the tenant test file opens
  with a block stating exactly what is and is not proven (Layer 1 yes, RLS no).

## 5. Gaps — honest, as of 2026-08-14

| Gap | Consequence |
|---|---|
| **No CI of any kind** (no `.github/`, no CI config anywhere) | Nothing forces the suite to run. Every "tests pass" claim is only as good as the human who ran them. Run the inventory yourself; never assume. |
| **Limited route-layer coverage** | One authenticated happy path covers registration through XML download; error statuses, Zod failures, and most endpoint branches remain untested. |
| **No Customs endpoint contract** | Direct submission is intentionally absent. XSD structure and preflight do not prove the withheld common types, code-list rules, or Click2Clear business validation. |
| **RLS (Layer 3) untestable locally** | Local Postgres role is superuser → RLS bypassed. Tests stay green because Layer 1 (Prisma extension) does the enforcing. Layer 3 is only meaningful on Neon (`neondb_owner` is not superuser). |
| **Services with limited direct test coverage** | Pure calculation, tariff import, TFP preflight and XML are covered; most CRUD/service orchestration still relies on typecheck, tenancy tests, smoke and manual UI checks. |
| **Workflow tests cover happy paths** | Fresh-account and seeded-smoke paths exist, but there are no concurrency or government business-validation cases. |

## 6. Golden inventory (certified numbers and fixtures)

**Smoke-script certified numbers** (seeded shipment `SHP-2026-00001`, org
`bahama-brokerage`, 3 mixed-basis lines: rum specific excise, t-shirts AD_VALOREM,
fridge with levy):
- Rum line excise: **1716.00** (600 L × 0.22 × $13/imperial gallon)
- Total CIF − total FOB: **2315.00** exactly (1850.00 freight + 320.00 insurance + 145.00 other)
- Post-artifact status: `DRAFT`; no endpoint is called.

**The 16 calc tests certify** (`tests/calculations.test.ts`), in addition to the original cases: additive duty, independent current/historical alcohol excise, exchange-rate conversion, package volume/proof-gallon conversion, and bulk-litre conversion.

The original cases include:
1. Apportionment splits proportionally by value.
2. Apportioned parts sum exactly to the charge (largest-remainder; 33.34/33.33/33.33 deterministic order).
3. Exact-sum holds across 97 uneven lines (remainder stress).
4. WEIGHT basis works, with value fallback for missing weights.
5. All-zero basis → equal split.
6. Simple shipment: CIF/duty/VAT/processing-fee composition (CIF 1200 → duty 540, fee 12.00, VAT 175.20, payable 727.20).
7. SPECIFIC duty is quantity-based, CIF-independent (36 L × 12 = 432; fee clamped to $10 minimum).
8. COMPOUND duty = greater of ad valorem vs specific (150 beats 100).
9. FULL exemption zeroes duty/levy/excise but VAT on CIF (+ fee VAT) survives.
10. Processing fee caps at $750.
11. Line totals reconcile exactly with shipment totals, and CIF total = FOB + all charges to the penny.

**The 5 isolation tests certify** (live DB, Layer 1): scoped findMany despite
identical `shipmentNumber` in both orgs; cross-org `findUnique` → null;
creates auto-stamped with tenant `organizationId`; cross-org `update` throws;
scoped `count` < global count.

**Fixtures:** demo shipment `SHP-2026-00001` (both orgs, deliberately
colliding numbers); bundled **1,544-code** tariff plus curated rate histories.

## Provenance and maintenance

- Re-verified 2026-08-14 from calculation/tariff/TFP/XML/transport-reference/invoice-selection tests, smoke, package scripts, seeds, schema, and README.
- If tests are added/removed, update the counts in §2 and the certified lists in §6; if CI or git appears, rewrite §5.
- If `scripts/smoke.ts` changes what it mutates or asserts, update §2's warning block first — it is the safety-critical paragraph.
