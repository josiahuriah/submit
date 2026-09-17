# Customs reference lists (16 September 2026)

The supplied lists are versioned in `src/lib/customs/data`. Source page and row numbers, spelling, alphanumeric codes and active status are retained. The PDFs' Active columns contain checkbox images, not text. Checked/unchecked images were extracted and verified visually; inactive rows are retained for provenance but excluded from new selections.

| Source | Rows | Active rows |
| --- | ---: | ---: |
| CPC_Codes.pdf | 720 across 71 groups | 667 across 63 groups |
| Customs_Ports.pdf | 156 | 151 |
| UOM.pdf | 42 | 42 |

CPC selection uses the explicit `(groupCode, code)` pair, never a prefix rule. The source includes duplicate rows and codes appearing in multiple groups. Identical pairs are deduplicated for the UI; membership under different groups is retained. The source has no separate group-description master: home consumption and duty concession have clear labels; otherwise groups with multiple entries use their group code.

## Workflow

- Select the shipment's CPC group. Home consumption (`400`) offers active line CPC `400000`; `400003` is inactive in the supplied list.
- Select a full CPC on each line. Multiple different item CPCs in the same group can share one declaration. Optional split filing still separates full item CPCs; each file retains the shipment's group and has its own sequence/reference.
- Choose the tariff quantity UOM from the active Customs list. HS search no longer overwrites it. The selected quantity/UOM is emitted as `TariffQuantity`; gross and net mass remain pounds (`LB`). Internal assessment-unit aliases remain internal to the calculator.
- Every new manifest requires a Customs port. Linked shipments read that current port for both `DeclarationOffice/ID` and `GoodsLocation/ID`; a shipment-level value cannot override it. Standalone shipments select a port directly.
- Editing a manifest invalidates linked draft calculations and review XML. Submitted XML and finalized line records remain unchanged. Existing draft lines have CPC/UOM correction controls.
- API/service validation and XML preflight enforce the same active lists and group membership as the UI.

## Successful example comparison

A focused excerpt of `example.xml`, excluding SOAP credentials, party identities and embedded documents, is retained in `tests/fixtures/customs-success-excerpt.xml`.

| XML field | Mapping |
| --- | --- |
| Declaration/GovernmentProcedure/CurrentCode | Shipment group, e.g. `4098` |
| Goods item/GovernmentProcedure/CurrentCode | Full CPC, e.g. `4098180020` |
| DeclarationOffice and GoodsLocation | Manifest Customs port, e.g. `NASACP` |
| EntryOffice | Voyage destination UN/LOCODE, e.g. `BSNAS` |
| UnloadingLocation | Destination location part, e.g. `NAS` from `BSNAS` |
| ExitOffice | Voyage origin UN/LOCODE; retain as a distinct routing field |
| TariffQuantity | Broker-selected quantity and Customs UOM (`EA`, `LB`, etc.) |
| GrossMassMeasure / NetNetWeightMeasure | `LB` |
| CurrencyExchange/RateNumeric | `1.0` for BSD |
| TradeTerms/LocationID | Incoterm code, e.g. `FOB`, rather than a city |

The example does not replace configured filing credentials or previously approved party IDs. Optional attached-document payloads, BorderTransportMeans, and no-manifest SOAP linkage retain the existing workflow. Regime codes remain separately entered because no regime master was supplied; group selection does not infer a regime. The change aligns the supplied code lists and relevant XML fields; it is not a claim of successful live Customs validation or an implementation of every optional sample element.

## Deployment and existing records

Apply `20260916120000_customs_reference_lists` with `npx prisma migrate deploy` before deploying the application. The production build guard requires this migration; no production database was changed during implementation.

- Existing manifests have no trustworthy Customs port to infer: choose one before editing or attaching them, or generating XML for their shipments.
- Draft `400` becomes full CPC `400000`; commercial `PCS`, `L`, and `KG` aliases become `EA`, `LTR`, and `KGM` without changing quantities.
- Existing bare `4098` remains unresolved until the broker selects the intended full concession CPC. The inactive generic `4098000000` is not assigned automatically.
- A legacy shipment with mixed groups gets no inferred group. Select a group and correct its lines before calculation/export. All drafts need recalculation and new review XML.
- Source rows with unchecked Active boxes remain unavailable even when their codes appear historically.

Source SHA-256:

- CPC_Codes.pdf: `0c2cb0f7f938351fd242f09af31015b68817ee3e7b6d3b0b3970bf9e7f08f35b`
- Customs_Ports.pdf: `f283e16cec6764744f7be113be88aa7d0d11e37ffd22956ad7607eee0ba9e84c`
- UOM.pdf: `8c1fe94296ca4c7b181ed016d0d6a08132c959961217a9a510e297b94a168e1a`

## Verification

- 91 unit/service tests passed. Two database integration suites were not run because no application database was configured. The xmllint-dependent test was skipped because xmllint was unavailable; the generated XML was separately validated with Python lxml against the same repository XSD and its committed common-type stub.
- Production application compilation and TypeScript checks passed using local placeholder environment values, with Customs transport disabled. This does not exercise a hosted database or the production migration guard.
- The migration was executed in an isolated PGlite PostgreSQL instance with standard, concession, mixed-group, empty and finalized shipment fixtures. It preserved finalized lines/calculations, invalidated draft calculations, migrated unambiguous aliases, retained unresolved concessions and restored FORCE RLS. This is a focused SQL migration check, not a production migration run.
- No Customs endpoint was contacted.
