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
| HS code | Harmonized System tariff classification. Submit requires the full dotted national format `"8703.23.10"`. The government code master must still confirm dotted versus undotted XML wire representation. | validation schema + TFP preflight |
| Duty basis | `AD_VALOREM` (CIF × rate), `SPECIFIC` (assessment quantity × BSD/unit), `COMPOUND` (greater), or `ADDITIVE` (sum; e.g. beer). | schema + duty calculator |
| Excise | Independent charge domain with `NONE` plus the same four bases. Spirits can therefore have free customs duty and specific excise per imperial/proof gallon. | duty calculator + HSCodeRate |
| Environmental levy | Ad valorem levy on CIF: `levy = CIF × levyRate`. Seeded on e.g. plastics, tyres, appliances, vehicles at 0.05. | `duty-calculator.ts` line 135, `prisma/seed.ts` |
| VAT | Value-added tax. **Base = CIF + duty + excise + levy**, not CIF alone and not CIF + duty. Default rate 0.10 in seed and schema default. | `duty-calculator.ts` lines 136–137, `schema.prisma` HSCodeRate.vatRate |
| Exemption | `ExemptionType` enum: `NONE`, `FULL`, `PARTIAL`, `CONDITIONAL`. Only `FULL` changes engine output (see below). PARTIAL/CONDITIONAL are computed in full and flagged; concession percentage is the caller's job (per the engine header, Phase 4 will formalize concession codes). | `schema.prisma` enum ExemptionType, `duty-calculator.ts` lines 20–25, 131 |
| Processing fee | Customs processing fee: 1% of **shipment-level** total CIF, clamped to [$10.00, $750.00], plus VAT on the fee itself. `HSCodeRate.processingFeeExempt` exists in the schema but is not consumed by the engine. | `duty-calculator.ts` lines 98–102, 160–164 |
| Hierarchy | Manifest → Shipment → Invoice (supplier commercial invoice) → LineItem. A manifest belongs to a voyage (vessel sailing on a journey between ports). Charges (freight/insurance/other) live on the Shipment and are apportioned down to LineItems. | `prisma/schema.prisma` |
| Declaration | A `CustomsEntry`: the filing of a shipment with Bahamas customs, typed by `DeclarationType` (see lifecycle section). | `schema.prisma` CustomsEntry |
| Single Window / Click2Clear | Government declaration platform. Submit currently produces TFP v1.4.4 WCO XML for review; no endpoint client or transport/auth assumption is wired. | README + TFP docs |
| CIF valuation | The repo assesses ad valorem charges on CIF (cost+insurance+freight). That the Bahamas legally uses CIF valuation is consistent with the code but is a real-world fact: **unverified — confirm against official sources**. | `duty-calculator.ts` |
| Largest-remainder apportionment | The exact-sum algorithm distributing shipment charges across lines (see Apportionment section). | `src/lib/calculations/apportionment.ts` |
| Rate freezing | At calculation time the applied rates (dutyBasis, dutyRate, specificRate, vatRate, levyRate, exciseRate) are copied onto each LineItem so the shipment stays auditable after tariff changes. | README, `schema.prisma` LineItem "Rates as applied" block |
| Staleness guard | Invoice/line mutations clear `calculatedAt`; review artifact generation refuses missing/stale calculations. | invoice + artifact services |
| BSD | Bahamian dollar. Assessment outputs are BSD; invoice-currency FOB converts using `Invoice.exchangeRate` before apportionment/tax. | money/duty calculator |

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
- Convert each invoice-currency line FOB to BSD using its stored exchange rate.

## Rate data

- `HSCodeRate` stores independent duty/excise bases, ad-valorem and specific
  rates/units, VAT/levy, effective period, gazette/source/page and verification.
  Rates live in their own table to answer "what was the rate when this
  shipment was assessed?".
- `npm run db:seed` loads the bundled 1,544-code duty schedule and protects a
  curated alcohol overlay. Beer `2203.00.10/.20/.30/.90` uses 10% + BSD 10 per
  imperial gallon. Exact spirits lines use historical (2023-07-01 through
  2025-06-30) BSD 15/proof gallon and current (from 2025-07-01) BSD 13/imperial
  gallon specific excise. Wine/coolers use their explicit ad-valorem excise rows.
- The PDF extraction has no trustworthy excise/levy columns. Unverified chapter
  22/24/27/87 lines fail calculation rather than silently using zero/default tax.

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

## Entry lifecycle and review artifacts

- `DeclarationType` (schema.prisma): `C13` home consumption (the default),
  `C14` temporary import, `C17` warehouse, `C18` transshipment, `OTHER`.
- `CustomsEntryStatus`: DRAFT → VALIDATED → SUBMITTED → UNDER_ASSESSMENT →
  ASSESSED → PAID → RELEASED, plus REJECTED and CANCELLED. (The enum defines
  the states; strict transition ordering beyond what services enforce is not
  encoded in the schema.)
- `CustomsEntry` currently records review artifacts: exact XML string,
  declaration/function/regime, schema/mapping versions, generation time and
  validation report. Reserved response/reference fields remain for a future
  verified endpoint adapter.
- Artifact preconditions: DRAFT shipment, current calculation, mandatory TFP
  data and full HS/CPC/invoice linkage. Generation never advances status.

## Provenance and maintenance

Re-verify each section against its source before trusting it after a refactor:

- Calculation order & exemptions → re-read `src/lib/calculations/duty-calculator.ts` (esp. lines 129–169, 185–201).
- Apportionment behavior → `src/lib/calculations/apportionment.ts` + apportion tests.
- Rounding/serialization → `src/lib/calculations/money.ts` (line 11 sets the mode).
- Rates & HS format → seed, schema HSCodeRate, validation schema and TFP preflight.
- Lifecycle enums → `prisma/schema.prisma` (CustomsEntryStatus, DeclarationType, ExemptionType).
- All numeric claims → `npm test` (tests/calculations.test.ts is the executable spec).
- Anything labeled "unverified" → official Bahamas Customs / Tariff Schedule sources, never this file.
