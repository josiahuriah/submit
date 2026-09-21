# Fixed tariff units and allocated pounds

Sources: user-supplied `2023-Tariff-Schedule (1).pdf` and `UOM(1).pdf`, September 18, 2026.

All 1,544 codes in `prisma/data/hs-codes.json` are explicitly enumerated in `src/lib/customs/data/tariff-uoms.json`. Each record includes its one-based PDF page, original unit label, and Customs UOM. Runtime does not infer units from descriptions, chapters, or rates. The user approved EA for 94012010 and disabling Chapter 98 on September 18, 2026.

| Schedule unit | Customs code | Codes |
| --- | --- | ---: |
| pound | LBR | 742 |
| number / approved seat override | EA | 606 |
| 100 pounds | CWA | 80 |
| gallon / imperial gallon | GLI | 31 |
| ton | L84 | 16 |
| cubic feet | FTQ | 14 |
| proof gallon | PGL | 11 |
| thousand linear inches | T8 | 2 |
| blank Chapter 98 | disabled | 42 |

The Customs list distinguishes UK and US gallons. The schedule's gallon is mapped to the UK gallon, consistent with its imperial-gallon labels; ton uses the supplied UK ton. Source spelling `100 poundss`, punctuation `ton.`, capitalization `Number`, and the wrapped `1000 linear inches` are normalized explicitly.

## Source gaps

The 42 Chapter 98 codes are disabled in search, seed data, database reference rows, line mutations, and recalculation. Historical declarations remain unchanged. Tariff 94012010 is assigned EA by explicit user approval; its source unit remains recorded as blank with an assignment note. The blank source cell was visually verified on PDF page 889 (printed page 893).

All 1,502 enabled codes in the imported tariff list now have assigned UOMs.

## Quantities and weights

Quantity and unit price must be entered in the assigned statistical unit. Gross pounds remain a separate allocation, not an inference of product quantity, volume, or actual measured item weight. Legacy quantities in a different unit must be re-entered; merely changing their unit label could corrupt tax assessment.

Gross and optional net shipment pounds are apportioned by line invoice value across every invoice. An all-zero-value shipment uses equal shares. Largest-remainder rounding at 0.001 lb preserves each shipment total exactly. Allocation refreshes after invoice/line edits, deletions, and shipment edits, independently of tax calculation. Calculation repeats and persists the allocation before XML generation. Missing gross weight prevents calculation. Net weight cannot exceed gross weight. Split declarations still require positive allocated gross pounds and package counts per item; totals too small to provide a positive 0.001 lb to every item must be corrected.

The migration updates global HS reference units and invalidates draft calculations. Historical submitted declarations are untouched. Apply the migration during deployment; the runtime map also overrides stale search metadata. No Customs endpoints were contacted for this change.
