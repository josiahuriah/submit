---
name: submit-calculations-and-money
description: The money contract for Submit — duty/VAT/excise/levy/processing-fee math, Decimal handling, cost apportionment, rate freezing, and the calculation staleness guard. Use when touching anything under src/lib/calculations/ or calculations.service.ts, when adding a new tax or fee, when fixing rounding bugs or "totals don't reconcile" reports, when computing expected values for tests, or when debugging why a shipment refuses to submit ("run the duty calculation first").
---

# Submit: Calculations and Money

Date-stamped 2026-07-08. Everything below is derived from the code in THIS repo (`/Users/joshduncanson/Downloads/submit`). If code and this doc disagree, the code wins — then fix this doc.

The money engine is three pure files (`src/lib/calculations/money.ts`, `apportionment.ts`, `duty-calculator.ts`), one executable spec (`tests/calculations.test.ts`, 11 tests), and one DB bridge (`src/server/services/calculations.service.ts`). This skill is the contract for changing any of them without corrupting customs declarations.

## When NOT to use this skill

- **Domain theory** — what CIF means, why The Bahamas taxes this way, tariff/glossary questions → `bahamas-customs-reference`.
- **General evidence/verification standards** (what counts as "tested") → `submit-validation-and-qa`.
- Layering rules, schema/migration mechanics, auth, API shapes, BEAIP submission flow, change control → the sibling skills `submit-architecture-contract`, `submit-schema-and-migrations`, `submit-auth-and-tenancy`, `submit-api-conventions`, `submit-beaip-integration-campaign`, `submit-build-and-env`, `submit-change-control`.

## Hard rules

| # | Rule | Source |
|---|------|--------|
| 1 | **decimal.js only. Never native floats on money.** No `Number` arithmetic, no `parseFloat`, no `+` on money values. | `money.ts:1-8` ("floats are banned from this codebase for money") |
| 2 | **Construct Decimals from strings**, not numbers. The service converts every Prisma Decimal with `String(...)` before feeding the engine. | `calculations.service.ts:85-111` |
| 3 | **Global Decimal config: `precision: 28`, `ROUND_HALF_UP`.** Money rounds to 2dp half-up via `toMoney()`. Do not re-`Decimal.set()` anywhere else. | `money.ts:11,25-27` |
| 4 | **Rounding happens at defined points only**: each apportioned share (to whole cents inside `apportion`), CIF, each tax amount, each roll-up total, the fee, fee-VAT. Intermediate products stay unrounded. | `duty-calculator.ts:128-168`, `apportionment.ts:56-86` |
| 5 | **Money serializes as strings** — `moneyString()` (`toFixed(2)`) for API responses and Prisma writes. Never emit a JSON number for money. | `money.ts:30-32`, `calculations.service.ts:125-193` |
| 6 | **All values are BSD.** No currency conversion exists in the domain. | `money.ts:6` |
| 7 | **Rates are frozen onto LineItem at calculation time** (dutyBasis, dutyRate, specificRate, specificRateUnit, vatRate, levyRate, exciseRate). Historical shipments are NEVER recomputed with current rates — the frozen copy is the audit record after a tariff change. | `calculations.service.ts:133-141`, `schema.prisma` LineItem "Rates as applied" block |
| 8 | **Staleness guard**: any invoice or line-item mutation nulls `Shipment.calculatedAt`; submission is refused until recalculated. See "Staleness guard semantics" below. | `invoices.service.ts:45-47`, `declarations.service.ts:74-84` |
| 9 | **Only DRAFT shipments can be recalculated** (and only DRAFT submitted). | `calculations.service.ts:44-46` |
| 10 | **Per-line apportioned cents must sum EXACTLY to the shipment charge.** Never replace largest-remainder with per-line proportional rounding. | `apportionment.ts:5-15`, awkward-thirds test |

## Engine anatomy

### `src/lib/calculations/money.ts` (43 lines)

- `Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP })` — module-level, applies globally on first import.
- `d(value)` — null/undefined → `ZERO`; otherwise `new Decimal(value)`. This is why optional rates can be passed as `null`.
- `toMoney(value)` — `toDecimalPlaces(2, ROUND_HALF_UP)`. The ONLY sanctioned money-rounding call.
- `moneyString(value)` — `toMoney(...).toFixed(2)`. The ONLY sanctioned serialization.
- `sum(values)`, `clamp(value, min, max)` — used for roll-ups and the processing-fee band.

### `src/lib/calculations/apportionment.ts` (98 lines)

```ts
apportion(charge, lines: ApportionableLine[], basis: 'VALUE' | 'WEIGHT' = 'VALUE'): ApportionedAmount[]
```

Largest-remainder method, in cents:
1. Round the charge to 2dp; work in `totalCents`.
2. Per line: exact proportional cents share → floor → track fractional remainder.
3. Hand leftover cents one each to the largest remainders; ties broken by input order (deterministic).

Edge cases (all under test):
- **Weight fallback**: `basis === 'WEIGHT'` but a line has missing/zero `weightKg` → that line's basis weight falls back to its `totalValue` (it gets a fair share, not zero). `apportionment.ts:89-98`.
- **All-zeros basis** (e.g. free-of-charge samples): equal split across lines so the charge is still fully allocated. `apportionment.ts:51-54`.
- **Zero charge** → all-zero amounts; **empty lines** → `[]`.
- Guarantee: returned amounts sum exactly to `toMoney(charge)`, in input order.

### `src/lib/calculations/duty-calculator.ts` (213 lines)

```ts
calculateShipment(lines: CalculationLineInput[], charges: ShipmentChargesInput, options?: CalculationOptions): ShipmentCalculationResult
calculateDuty(cif: Decimal, line: CalculationLineInput): Decimal   // exported separately
```

Rates are **fractions as strings** (`'0.45'` = 45%); `specificRate` is BSD per unit. Formula order (do not reorder):

1. **Apportion** freight, insurance, otherCharges independently across lines (each exact-sum).
2. **Per line**: `CIF = toMoney(FOB + freightShare + insuranceShare + otherShare)`; then
   - `duty` per basis: `AD_VALOREM` = `toMoney(CIF × dutyRate)`; `SPECIFIC` = `toMoney(quantity × specificRate)` — **CIF plays no role**; `COMPOUND` = `Decimal.max(adValorem, specific)` — **greater-of**, not sum. Unknown basis falls through to ad valorem.
   - `excise = toMoney(CIF × exciseRate)`; `levy = toMoney(CIF × levyRate)` — both on CIF.
   - `vat = toMoney((CIF + duty + excise + levy) × vatRate)` — VAT base includes ALL of duty, excise, levy.
   - `lineTotalTaxes = duty + vat + levy + excise` (unrounded sum of already-rounded parts).
3. **Roll-ups**: totalFob, totalCif, totalDuty, totalLevy, totalExcise — each `toMoney(sum(...))`.
4. **Processing fee** (shipment level): `clamp(totalCIF × rate, min, max)` with defaults `1%, $10.00, $750.00`; then `vatOnFee = toMoney(fee × max(line vatRates))`. `totalVat = toMoney(sum(line VATs) + vatOnFee)`. `totalPayable = duty + vat + levy + excise + fee` (CIF itself is not payable).

**Exemption handling** (`exemptionType` per line):
- `FULL` → duty, excise, levy zeroed. **VAT still applies to CIF** (the VAT base collapses to CIF; vat is NOT zeroed unless the caller also zeroes `vatRate`). Test: "zeroes duty/levy/excise on FULL exemption but keeps VAT on CIF" — $500 FULL-exempt line still yields $51.00 VAT ($50 on CIF + $1 fee-VAT).
- `PARTIAL` / `CONDITIONAL` → currently computed IN FULL and merely flagged; concession percentages are the caller's job (Phase 4 per the file header). Do not invent partial math in the engine without updating this contract.

## THE trap list

1. **VAT base includes excise AND levy.** `vatBase = CIF + duty + excise + levy` (`duty-calculator.ts:136`). Generic customs intuition — and the older, abandoned iteration of this project — uses a different VAT base. Never port that math here.
2. **Largest-remainder ≠ naive proportional rounding.** Rounding each share independently strands pennies. The awkward-thirds test is the canary: $100 over three equal lines must be exactly `33.34 / 33.33 / 33.33` (first line gets the extra cent), and the 97-line stress test must sum to `4321.99` exactly.
3. **SPECIFIC duty ignores CIF entirely** — `quantity × specificRate`. Rum test: CIF $700, duty = 36 L × $12 = $432.00. Quantity units must match `specificRateUnit` (L, LPA, KG…) — the engine does no unit conversion.
4. **COMPOUND = greater-of**, not ad-valorem-plus-specific. `Decimal.max(adValorem, specific)`.
5. **Processing fee is shipment-level, clamped, and itself VAT-able.** 1% of TOTAL shipment CIF, clamped to [$10, $750], never computed per line. Fee-VAT uses the max line VAT rate and lands inside `totalVat` — so `totalVat ≠ sum(line vatAmounts)`. When reconciling, remember: `totalVat = Σ line VAT + fee VAT`.
6. **FULL exemption does NOT kill VAT.** See exemption handling above.
7. **`processingFeeExempt` exists on `HSCodeRate` in the schema but is NOT consumed by the engine or service yet.** Don't assume it works; wiring it up is an extension (see checklist).
8. **Never recompute a submitted/historical shipment with current rates.** Frozen line-item rates are the audit trail; recalculation is blocked for non-DRAFT anyway.
9. **`lineTotalTaxes` excludes the processing fee** (fee is shipment-level), so `Σ lineTotalTaxes ≠ totalPayable`. The gap is exactly `processingFee + vatOnFee`.

## Service boundary

The pure engine (`src/lib/calculations/*`) does: math, apportionment, rounding. Deterministic, no Prisma, no HTTP, no Date, no config lookup. Unit-testable in isolation.

`calculations.service.ts` adds everything else, in order:
1. Load shipment + line items (`shipmentsRepository.withLineItemsForCalculation`); reject non-DRAFT, zero lines, lines missing `hsCodeId`.
2. Resolve each distinct HS code's CURRENT rate: `hSCodeRate.findMany({ where: { hsCodeId: { in }, effectiveTo: null } })` — `effectiveTo IS NULL` means active. Reject HS codes with no active rate.
3. Map DB rows → engine inputs, stringifying every Decimal.
4. Run `calculateShipment()`.
5. Persist in ONE `$tenantTransaction`: every line's amounts + apportioned costs + **frozen rates**, then the shipment roll-ups + `calculatedAt`. Then `writeAudit` (event `CALCULATED`).
6. Return totals/lines as `moneyString` values.

If you need calc results anywhere else (UI what-if, background job), call the pure engine — do not add a second DB-coupled path.

## Staleness guard semantics

Two mechanisms, both enforced at submit time in `declarations.service.ts:74-84`:

1. **Explicit clearing** — `invoices.service.ts` has a private `invalidateCalculation()` that sets `shipment.calculatedAt = null`. It is called by ALL six invoice-layer mutations: `createInvoice`, `updateInvoice`, `deleteInvoice`, `createLineItem`, `updateLineItem`, `deleteLineItem`.
2. **Timestamp comparison** — shipment-level edits (e.g. `freightCharge` via `shipments.service.update`) do NOT null `calculatedAt`; they bump `updatedAt`. Submit refuses when `calculatedAt < updatedAt` by more than 5,000 ms (the tolerance exists because the calculation itself bumps `updatedAt`).

Submit errors you will see: "Run the duty calculation before submitting this declaration" (calculatedAt null) and "Shipment changed after the last calculation — recalculate before submitting" (drift > 5s). The dashboard also disables the Submit button while `calculatedAt` is null.

**If you add any mutation that affects money inputs** (line values, quantities, weights, HS codes, exemptions, charges), it MUST either null `calculatedAt` or bump `Shipment.updatedAt`, or stale numbers become submittable.

## Verification recipes

Run the executable spec (11 tests):

```bash
npm test                                      # full vitest suite
npx vitest run tests/calculations.test.ts     # just the calc spec
```

Add a regression case following the file's existing style — string inputs, the `eq` helper, inline arithmetic comments justifying every expected value:

```ts
const eq = (a: Decimal, b: string) => expect(a.toFixed(2)).toBe(b)

it('describes the exact behavior', () => {
  const result = calculateShipment(
    [{ id: 'l1', totalValue: '1000.00', quantity: '10', rates: standardRates }],
    { freightCharge: '150.00', insuranceCharge: '30.00', otherCharges: '20.00' },
  )
  // CIF = 1000 + 150 + 30 + 20 = 1200
  eq(result.totalCifValue, '1200.00')
})
```

Rule: never commit an expected value you have not derived by hand (comment the arithmetic) or machine-checked against the engine.

End-to-end (needs DB + seed data; exercises real services, mock BEAIP, spot-checks rum SPECIFIC duty = 6000.00 and apportionment exactness CIF−FOB = 2315.00):

```bash
npx tsx scripts/smoke.ts
```

Machine-check the worked example below (exits 1 on any mismatch):

```bash
npx tsx .claude/skills/submit-calculations-and-money/scripts/verify-example.ts
```

## Worked example (machine-verified)

Distinct from every test case. Verified against the real engine on 2026-07-08 via `scripts/verify-example.ts` (all 18 numbers matched, exit 0).

Shipment: freight $75.55, insurance $0, other $0, VALUE apportionment, default fee params.

| | perfume | misc |
|---|---|---|
| Input | FOB 240.00, qty 12, COMPOUND (dutyRate 0.30, specific 5.00), VAT 0.10, excise 0.05, levy 0.01 | FOB 119.99, qty 2, AD_VALOREM 0.20, VAT 0.10 |
| Freight share | **50.37** (7555¢ × 240/359.99 = 5036.81¢ → floor 5036 + the 1 leftover cent, largest remainder) | **25.18** (2518.19¢ → floor 2518) |
| CIF | **290.37** | **145.17** |
| Duty | **87.11** (COMPOUND: ad valorem 290.37×0.30 = 87.11 > specific 12×5 = 60.00 — here ad valorem wins) | **29.03** (145.17×0.20) |
| Excise / Levy | **14.52** / **2.90** (CIF × 0.05 / × 0.01) | 0.00 / 0.00 |
| VAT | **39.49** ((290.37+87.11+14.52+2.90) × 0.10 = 394.90 × 0.10) | **17.42** ((145.17+29.03) × 0.10) |

Shipment totals: FOB **359.99**, CIF **435.54**, duty **116.14**, excise **14.52**, levy **2.90**. Processing fee: 1% × 435.54 = 4.36 → clamped UP to **10.00**; fee-VAT = 1.00. `totalVat` = 39.49 + 17.42 + 1.00 = **57.91**. `totalPayable` = 116.14 + 57.91 + 2.90 + 14.52 + 10.00 = **201.47**.

Note the freight shares sum to exactly 75.55, and this COMPOUND case is the mirror of the test's (there specific wins; here ad valorem wins).

## Extension checklist — adding a new tax or fee

Thread it through ALL of these, in order:

1. **Engine types** (`duty-calculator.ts`): field on `LineRates` (per-line rate) or `CalculationOptions` (shipment-level fee); output field on `LineCalculationResult` and/or `ShipmentCalculationResult`.
2. **Engine math**: insert at the correct point in formula order — and decide explicitly whether it joins the VAT base (see trap #1) and whether FULL exemption zeroes it.
3. **Schema** (`prisma/schema.prisma`): rate column on `HSCodeRate` (`@db.Decimal(6, 4)`), frozen-rate + amount columns on `LineItem` (`Decimal(6,4)` / `Decimal(12,2)`), roll-up on `Shipment` (`Decimal(14,2)`). Migration per `submit-schema-and-migrations`.
4. **Service** (`calculations.service.ts`): select the rate in the `hSCodeRate.findMany`, map into `engineLines` (stringified), persist frozen rate + amount per line and the roll-up, all inside the existing `$tenantTransaction`.
5. **Staleness**: if the rate comes from a new mutable input, ensure its mutations clear `calculatedAt` or bump `updatedAt`.
6. **Validation / API**: zod schemas and response serialization (money as strings) per `submit-api-conventions`.
7. **Tests** (`tests/calculations.test.ts`): at minimum — basic amount, interaction with VAT base, FULL-exemption behavior, and the line-vs-shipment reconciliation test still passing. Update `scripts/smoke.ts` spot checks if seeded data is affected.
8. Re-run `npm test`, `npx tsx scripts/smoke.ts`, and this skill's `verify-example.ts`; update this SKILL.md if the contract changed.

## Provenance and maintenance

- Sources: `src/lib/calculations/{money,apportionment,duty-calculator}.ts`, `tests/calculations.test.ts`, `src/server/services/{calculations,invoices,declarations,shipments}.service.ts`, `prisma/schema.prisma`, `scripts/smoke.ts` — all read in full on 2026-07-08; no external or historical sources.
- Worked example verified by executing the repo engine (`scripts/verify-example.ts`, exit 0) on 2026-07-08.
- Re-verify this skill whenever any file above changes; `verify-example.ts` failing means this doc is stale.
