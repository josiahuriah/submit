# Session Handoff — 2026-07-31: TFP Single Window + Full Workflow UI

Second session handoff, following `integration-handoff.md` (2026-07-29). Same
rules: the `.claude/skills/` library is the authority on how the system works;
this file covers only what this session changed, the decisions behind it, and
what remains. The authority on the TFP integration itself is
`tfp-single-window-gap-analysis.md` — read that before touching anything
BEAIP/TFP-related.

---

## 1. What this session did (three chunks)

### a. TFP Single Window documents arrived; gap analysis written

The government released the DEC message spec v1.4.4, `TFB_WCO_DEC_v1.4.4.xsd`,
and a sample instance (misnamed `sample.xsd` — it is XML, not a schema). They
are withholding `TFB_Common_Types.xsd` and all code-master worksheets until we
can **submit a valid declaration XML file** ("the sample-file gate").
Everything learned is in `docs/tfp-single-window-gap-analysis.md`, including
the full field mapping. The four facts that override earlier assumptions:

1. The wire format is a WCO 3.8 XML `Declaration` document
   (namespace `http://globaletrade.services/Declaration`) — **not** the
   SOAP-wrapped payload guessed in `production-client.ts`. Do not touch the
   SOAP plumbing until endpoint docs arrive (their integration steps 4–5).
2. C13/C14/C17/C18 **never appear on the wire**. The message uses Regime
   `TypeCode` (sample: `4`) + CPC codes. Our `DeclarationType` is a domain
   label only.
3. `DutyTaxFee` is **left blank on submission** — Click2Clear computes the
   amounts; reconciliation happens against the *response*.
4. The government's own sample fails its own XSD until
   `xmlns="http://globaletrade.services/Declaration"` is added to the root.

### b. WCO XML generation built and validated

- `src/lib/beaip/wco-xml.ts` — builds the declaration document in exact XSD
  element order. `tests/wco-xml.test.ts` pins ordering, namespace,
  DateTimeString convention, DutyTaxFee omission, and full xmllint validation.
- `src/server/services/declaration-mapper.ts` — ONE select + mapper shared by
  the live submit path (`declarations.service.ts`) and the generator, so the
  government file can never drift from what the app submits.
  `BeaipDeclaration` (`src/lib/beaip/types.ts`) was extended accordingly.
- `npm run wco:generate [shipmentNumber] [orgSlug]` — generates + validates
  via xmllint against `docs/tfp/TFB_WCO_DEC_v1.4.4.xsd` and the **stub**
  `docs/tfp/TFB_Common_Types.xsd`. When the official common-types file
  arrives, drop it over the stub and re-run — validation tightens itself.
- Deliverables generated: `docs/tfp/generated/declaration-SHP-2026-0000{1,2}.xml`.

**Labeled placeholders (fix before sending anything to the government):**
Regime=`4`; `Submitter/ID` falls back `licenseNumber → tinNumber →
"CRN-PENDING"` (set the real broker CR number on `Organization.licenseNumber`);
transport-mode and package-UOM code maps in `wco-xml.ts` are UN/EDIFACT
guesses; office code emits our `NAS` while the spec sample hints numeric `01`
— ask the integration team which.

### c. Full workflow UI — manifest → shipment → invoice → lines → submit

All previously scaffold/dead surfaces are now wired, each verified end-to-end
in the browser:

| Piece | Files |
|---|---|
| Manifests list + create (voyage/agent pickers) | `(app)/manifests/page.tsx`, `manifests-view.tsx`, `src/lib/data/manifests.ts` |
| New-shipment form (server-allocated `SHP-YYYY-NNNNN`, collision-retry) | `(app)/shipments/new/*`, `src/lib/data/shipment-actions.ts` |
| Add-invoice card (shown when shipment has no invoice) | `(app)/shipments/[id]/entry/add-invoice-card.tsx`, `src/lib/data/invoices.ts` |
| Wired submit (header + ledger, BROKER-gated, C13, errors-as-data) | `entry/submit-button.tsx`; "Save draft" scaffold button removed; entry row locks when not DRAFT |

All actions follow the `line-items.ts` Server Action pattern: session + RBAC +
tenant client + audit re-asserted per action, expected failures returned as
data (production builds redact thrown action errors). One backend tweak:
`catalog.service.ts` MANIFEST_SELECT now includes `voyage.arrivalDate`.

## 2. Verification state (all green at commit time)

`npx tsc --noEmit` clean · `npm test` 34/34 (was 26; +8 WCO XML) ·
`npm run build` clean · `scripts/smoke.ts` green through the new mapper (rum
duty exactly $6,000.00) · browser walkthrough of the full path ending in mock
acceptance. Ledger-vs-footer VAT check still behaves per the money rules
($378.00 vs $375.00 = VAT on the $30 processing fee).

## 3. Traps hit this session

- **`npm run build` while the dev server runs corrupts `.next`** ("Cannot
  find module './8543.js'"). Restart the dev server after production builds.
- PDF reading needed `pip3 install --user pypdf` (no poppler on this Mac).
- `.claude/launch.json` now exists — dev server starts via the preview tool.
- Dev login: `broker@bahamabrokerage.test` / `Password123!`.

## 4. Dev-data state

- `SHP-2026-00001` (demo) — DRAFT, calculated, untouched.
- `SHP-2026-00002` + manifest `MAN-2026-0900` — created via the UI walkthrough,
  left as a SUBMITTED example. Safe to delete; nothing depends on them.

## 5. Open items, in order

1. **Send the sample file**: set real CR number, confirm office-code format,
   regenerate, deliver `declaration-*.xml` → unlocks common types + worksheets.
2. When worksheets arrive: code-mapping tables (regime, office, UOM, package
   UOM, transport mode), HS dotted-vs-undotted confirmation, real
   common-types validation.
3. Schema Phase 3 (owner approval, `submit-schema-and-migrations`): structured
   addresses on Client/Supplier, invoice-level FX rate + per-invoice charges,
   incoterm, Organization CR field, per-item packaging/net weight.
4. Rewrite `production-client.ts` serialization around `wco-xml.ts` only when
   transport/endpoint docs arrive (campaign Gates 2–3).
5. Prior-session items still open: excise-data gap (chapters 22/87), Neon
   credential rotation, no ESLint/CI, multi-invoice line-entry picker (the
   add-invoice card only appears when there is NO invoice; commits still go to
   the first invoice).

## 6. Change-control ledger (this session)

Class B (evidence above): all workflow UI + data-seam files, wco-xml + tests,
declaration-mapper refactor, catalog select addition, README updates.
Class C: gap-analysis doc, this file, campaign-skill ledger note,
`.gitignore` `.DS_Store` line, `.claude/launch.json`.
Class A items touched: **none** — no money-math, schema, auth, or dependency
changes. (`BeaipDeclaration` reshaping is pre-wire-format plumbing, not a
wire-format change; flagged here per protocol.)
