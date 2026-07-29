---
name: bahamas-customs-reference
description: >-
  Domain-theory reference for Bahamas customs concepts as implemented in
  Submit: CIF, FOB, HS codes, duty bases (AD_VALOREM/SPECIFIC/COMPOUND),
  excise, environmental levy, VAT base, exemptions, processing fee,
  apportionment, BEAIP. Use when asking "why is VAT higher than expected",
  "how is duty on alcohol/fuel computed", "numbers don't sum to the charge",
  "what does FULL exemption zero out", "what is CIF vs FOB", "what duty basis
  applies", "why is the processing fee $10/$750", "what do the C13/C14 codes
  mean", or any question about what a customs term means in this codebase.
---

# Bahamas customs reference (as implemented in Submit)

Date-stamped: 2026-07-08. This is the domain-theory pack: what each customs
concept **means** and how **this repo** implements it. Every claim below is
grounded in a file in this repository; pure-domain facts that the repo does not
itself establish are explicitly labeled **unverified — confirm against official
sources**.

**When NOT to use this skill**

- Code anatomy, function signatures, verification recipes, and how to run or
  extend the calculation engine → `submit-calculations-and-money`.
- Layering/service boundaries → `submit-architecture-contract`. Environment
  and build → `submit-build-and-env`. Prisma/migrations →
  `submit-schema-and-migrations`. Auth/tenancy → `submit-auth-and-tenancy`.
  API shapes → `submit-api-conventions`. Validation/QA →
  `submit-validation-and-qa`. BEAIP production work →
  `submit-beaip-integration-campaign`. Process → `submit-change-control`.

---

## Glossary

| Term | Meaning in this repo | Grounding |
|---|---|---|
| FOB | Free-on-board value of a line item — the goods' invoice value before shipping costs. Stored as `LineItem.totalValue` ("line FOB"). | `prisma/schema.prisma` (LineItem), `duty-calculator.ts` header |
| CIF | Cost + Insurance + Freight: `FOB + apportioned freight + insurance + other charges`, per line. The customs value on which ad valorem charges are assessed. | `duty-calculator.ts` lines 8–9, 129 |
| HS code | Harmonized System tariff classification. Canonical stored format is dotted: `"8703.23.10"` (4-digit heading, 2-digit subheading, optional 2-digit national suffix). The mock BEAIP validator enforces `/^\d{4}\.\d{2}(\.\d{2})?$/` — so `2208.40` and `2208.40.00` both pass; `220840` does not. The Zod input schema (`src/lib/validation/schemas.ts` line 136) only enforces string length 4–15; there is **no normalization step** in the codebase — the dotted format must be supplied as-is. | `prisma/seed.ts` HS_SUBSET, `src/lib/beaip/mock-client.ts` line 23, `src/lib/validation/schemas.ts` |
| Duty basis | `DutyBasis` enum: `AD_VALOREM` (duty = CIF × dutyRate), `SPECIFIC` (duty = quantity × specificRate in BSD per unit — alcohol, fuel; README calls correct handling of this "the accuracy gap competitors miss"), `COMPOUND` (the **greater** of the two). | `prisma/schema.prisma` enum DutyBasis, `duty-calculator.ts` lines 185–201 |
| Excise | Additional ad valorem tax on CIF for certain goods (vehicles, tobacco per the engine's header comment). `excise = CIF × exciseRate`. | `duty-calculator.ts` lines 14, 134 |
| Environmental levy | Ad valorem levy on CIF: `levy = CIF × levyRate`. Seeded on e.g. plastics, tyres, appliances, vehicles at 0.05. | `duty-calculator.ts` line 135, `prisma/seed.ts` |
| VAT | Value-added tax. **Base = CIF + duty + excise + levy**, not CIF alone and not CIF + duty. Default rate 0.10 in seed and schema default. | `duty-calculator.ts` lines 136–137, `schema.prisma` HSCodeRate.vatRate |
| Exemption | `ExemptionType` enum: `NONE`, `FULL`, `PARTIAL`, `CONDITIONAL`. Only `FULL` changes engine output (see below). PARTIAL/CONDITIONAL are computed in full and flagged; concession percentage is the caller's job (per the engine header, Phase 4 will formalize concession codes). | `schema.prisma` enum ExemptionType, `duty-calculator.ts` lines 20–25, 131 |
| Processing fee | Customs processing fee: 1% of **shipment-level** total CIF, clamped to [$10.00, $750.00], plus VAT on the fee itself. `HSCodeRate.processingFeeExempt` exists in the schema but is not consumed by the engine. | `duty-calculator.ts` lines 98–102, 160–164 |
| Hierarchy | Manifest → Shipment → Invoice (supplier commercial invoice) → LineItem. A manifest belongs to a voyage (vessel sailing on a journey between ports). Charges (freight/insurance/other) live on the Shipment and are apportioned down to LineItems. | `prisma/schema.prisma` |
| Declaration | A `CustomsEntry`: the filing of a shipment with Bahamas customs, typed by `DeclarationType` (see lifecycle section). | `schema.prisma` CustomsEntry |
| BEAIP | The Bahamas' electronic single-window for customs declarations, modeled here as a `BeaipClient` interface (mock + production SOAP implementations). Expansion of the acronym: **unverified — confirm against official sources**; the repo never spells it out. | `src/lib/beaip/types.ts`, README "BEAIP integration" |
| CIF valuation | The repo assesses ad valorem charges on CIF (cost+insurance+freight). That the Bahamas legally uses CIF valuation is consistent with the code but is a real-world fact: **unverified — confirm against official sources**. | `duty-calculator.ts` |
| Largest-remainder apportionment | The exact-sum algorithm distributing shipment charges across lines (see Apportionment section). | `src/lib/calculations/apportionment.ts` |
| Rate freezing | At calculation time the applied rates (dutyBasis, dutyRate, specificRate, vatRate, levyRate, exciseRate) are copied onto each LineItem so the shipment stays auditable after tariff changes. | README, `schema.prisma` LineItem "Rates as applied" block |
| Staleness guard | Any invoice/line-item mutation clears `shipment.calculatedAt` (`src/server/services/invoices.service.ts` line 46); submission refuses unless `calculatedAt` exists and is ≥ `updatedAt` (`src/server/services/declarations.service.ts` lines 74–79). | those files |
| BSD | Bahamian dollar. All money in the domain is BSD; no currency conversion exists. | `src/lib/calculations/money.ts` header |

## The calculation order (duty-calculator.ts, `calculateShipment`)

Follow this exact sequence when reasoning about any number:

1. **Apportion** freight, insurance, and other charges across lines
   (largest-remainder, basis VALUE by default) — lines 111–121.
2. **CIF per line** = FOB + freight share + insurance share + other share,
   rounded to cents — line 129.
3. **Duty per line** by basis (`calculateDuty`, lines 185–201):
   - `AD_VALOREM`: CIF × dutyRate (rate is a fraction: 0.45 = 45%)
   - `SPECIFIC`: quantity × specificRate (BSD per unit; quantity must be in
     the rate's unit, e.g. litres)
   - `COMPOUND`: `Decimal.max(adValorem, specific)` — greater-of, never sum.
4. **Excise** = CIF × exciseRate; **levy** = CIF × levyRate — lines 134–135.
5. **VAT** = (CIF + duty + excise + levy) × vatRate — lines 136–137.
   **This is the #1 trap**: the VAT base includes excise and levy, not just
   CIF + duty. If VAT looks "higher than expected", check whether the line
   carries excise or levy (e.g. seeded vehicles: excise 0.25–0.65 + levy 0.05).
6. **Processing fee** (shipment level) = 1% × total CIF, clamped [$10, $750]
   — lines 160–163. Then **VAT on the fee** at the highest vatRate across
   lines (`effectiveVatRate`, lines 207–209) is added into `totalVat` —
   lines 164–166. So `totalVat` ≠ sum of line `vatAmount`s; the difference is
   exactly the fee VAT.
7. **totalPayable** = duty + VAT + levy + excise + processing fee — lines
   167–169. CIF itself is not payable; it is the base.

**Exemption semantics (verified in code, lines 131–137, and in
`tests/calculations.test.ts` "zeroes duty/levy/excise on FULL exemption")**:
`exemptionType: 'FULL'` zeroes **duty, excise, and levy** for that line, but
VAT is still charged **on the bare CIF** (the VAT base collapses to CIF because
the other three are zero) — unless the caller also zeroes `vatRate`. The
processing fee and its VAT are unaffected by exemptions.

## Apportionment (apportionment.ts)

- **Why**: per-line cents must sum EXACTLY to the shipment charge; naive
  rounding leaves stray pennies that make declared totals disagree with the
  manifest (file header, lines 5–8). If someone reports "numbers don't sum to
  the charge", this module is the invariant that says they must.
- **Algorithm** (largest-remainder): exact proportional shares → floor each to
  cents → hand leftover cents one-by-one to the largest fractional remainders,
  ties broken by input order for determinism (lines 59–81).
- **Basis**: `VALUE` (line FOB, default) or `WEIGHT` (kg). On WEIGHT basis, a
  line with missing/zero weight **falls back to its value** so it still gets a
  fair share (lines 89–97). If the entire basis is zero (e.g. free-of-charge
  samples), the charge is **split equally** (lines 51–54).
- Tests encode all of this: 100.00 over three equal lines → 33.34/33.33/33.33;
  97 uneven lines of 4321.99 still sum exactly; weight basis 200/100 kg →
  60/30 of 90.00 (`tests/calculations.test.ts` lines 8–57).

## Money conventions (money.ts)

- decimal.js everywhere; floats are banned for money. Precision 28,
  **ROUND_HALF_UP** globally (line 11).
- `toMoney()` rounds to **2 decimal places, half-up** — applied at every
  intermediate money result in the engine (CIF, duty, excise, levy, VAT, fee).
- Serialization: `moneyString()` → `toFixed(2)` strings; the API always
  returns money as strings like `"13405.78"` (README API section).
- All values are BSD; no currency conversion exists in the domain.

## Rate data

- `HSCodeRate` (schema.prisma): `dutyBasis` (default AD_VALOREM), `dutyRate`
  Decimal(6,4) as a fraction (0.4500 = 45%), `specificRate` Decimal(12,4) in
  BSD per `specificRateUnit` ("L", "LPA", "KG"), `vatRate` (default 0.1000),
  `levyRate`, `exciseRate`, `processingFeeExempt`, and history fields
  (`effectiveFrom`/`effectiveTo` NULL = active, `changeReason`, `gazetteRef`).
  Rates live in their own table to answer "what was the rate when this
  shipment was assessed?".
- Seed data: `npm run db:seed` loads the 43-code `HS_SUBSET` from
  `prisma/seed.ts`, covering every duty basis — e.g. whisky/vodka
  `2208.30.00`/`2208.60.00` SPECIFIC $12.00/L; rum `2208.40.00` $10.00/L; beer
  `2203.00.10` $2.00/L; gasoline `2710.12.10` $1.06/L; cigarettes `2402.20.00`
  COMPOUND (220% ad valorem vs $260.00/KG); cars `8703.xx` duty 0 but excise
  0.25–0.65 + levy 0.05. All seeded rates `effectiveFrom` 2023-07-01.
  These seed rates are representative for the engine; treat exact real-world
  tariff values as **unverified — confirm against official sources**.
- Full data path: drop the 1,544-code 2023 Tariff Schedule extraction at
  `prisma/data/hs-codes.json` (same shape as `HS_SUBSET`) and re-run the seed
  (README "HS code data"; `prisma/seed.ts` lines 252–263 — the file takes
  precedence over the subset).

## Worked example (machine-verified): COMPOUND duty on cigarettes

Rate from seed: `2402.20.00` — dutyBasis COMPOUND, dutyRate 2.20 (220%),
specificRate $260.00/KG, vatRate 0.10, levy 0, excise 0.

Shipment: one line, FOB $1,500.00, quantity 20 (KG), freight $200.00,
insurance $50.00, other $0.

| Step | Computation | Result |
|---|---|---|
| CIF | 1500 + 200 + 50 + 0 (single line takes all charges) | 1,750.00 |
| Ad valorem candidate | 1750 × 2.20 | 3,850.00 |
| Specific candidate | 20 × 260.00 | 5,200.00 |
| Duty (COMPOUND = greater) | max(3850, 5200) | **5,200.00** |
| Excise, levy | 1750 × 0 | 0.00 |
| VAT base | 1750 + 5200 + 0 + 0 | 6,950.00 |
| VAT on lines | 6950 × 0.10 | 695.00 |
| Processing fee | 1% × 1750 = 17.50, within [10, 750] | 17.50 |
| VAT on fee | 17.50 × 0.10 | 1.75 |
| totalVat | 695.00 + 1.75 | 696.75 |
| totalPayable | 5200 + 696.75 + 0 + 0 + 17.50 | **5,914.25** |

Verified 2026-07-08 by replicating the engine's exact rounding points
(2dp half-up at each `toMoney` call) in Python `decimal`; semantics
cross-checked against `tests/calculations.test.ts` (COMPOUND greater-of test,
lines 112–132; fee-minimum clamp in the SPECIFIC alcohol test, line 108;
$750 cap test, lines 153–159).

## Entry lifecycle and BEAIP modeling

- `DeclarationType` (schema.prisma): `C13` home consumption (the default),
  `C14` temporary import, `C17` warehouse, `C18` transshipment, `OTHER`.
- `CustomsEntryStatus`: DRAFT → VALIDATED → SUBMITTED → UNDER_ASSESSMENT →
  ASSESSED → PAID → RELEASED, plus REJECTED and CANCELLED. (The enum defines
  the states; strict transition ordering beyond what services enforce is not
  encoded in the schema.)
- `CustomsEntry` persists the BEAIP round trip verbatim: `beaipReference`,
  `requestPayload`/`responsePayload` JSON, timestamps, `rejectionReason`.
  Filed declarations are legal documents — the audit trail is non-negotiable
  (README).
- Mock BEAIP (`src/lib/beaip/mock-client.ts`): validates that lines exist, a
  customs office code is set, and every HS code matches
  `^\d{4}\.\d{2}(\.\d{2})?$`. Accepted declarations get a `BS-YYYY-E######`
  reference and a `C-#####` entry number. **Deterministic failure hook**: a
  `brokerReference` containing `REJECT` (case-insensitive) forces rejection.
  `getDeclarationStatus` always returns `UNDER_ASSESSMENT` in mock mode.
- Submission preconditions (`src/server/services/declarations.service.ts`):
  shipment must have `calculatedAt` set and not older than `updatedAt`
  (the staleness guard), otherwise submission is refused.

## Provenance and maintenance

Re-verify each section against its source before trusting it after a refactor:

- Calculation order & exemptions → re-read `src/lib/calculations/duty-calculator.ts` (esp. lines 129–169, 185–201).
- Apportionment behavior → `src/lib/calculations/apportionment.ts` + apportion tests.
- Rounding/serialization → `src/lib/calculations/money.ts` (line 11 sets the mode).
- Rates & HS format → `prisma/seed.ts` HS_SUBSET, `prisma/schema.prisma` HSCodeRate, `src/lib/beaip/mock-client.ts` line 23.
- Lifecycle enums → `prisma/schema.prisma` (CustomsEntryStatus, DeclarationType, ExemptionType).
- All numeric claims → `npm test` (tests/calculations.test.ts is the executable spec).
- Anything labeled "unverified" → official Bahamas Customs / Tariff Schedule sources, never this file.
