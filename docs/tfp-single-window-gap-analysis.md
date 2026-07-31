# TFP Single Window (Click2Clear) — Gap Analysis

Written 2026-07-31. Sources: `TFP GOV CBR DEC Message Specification v1.4.4`
(CrimsonLogic, Jul 2020), `TFB_WCO_DEC_v1.4.4.xsd`, `sample.xsd`, all in
`~/Downloads/`; compared against the codebase at commit `b72bc45` and the
`submit-beaip-integration-campaign` skill. This doc is the Gate 2 "field-mapping
document" the campaign calls for, produced early because the spec arrived
before the WSDL.

---

## 1. What the three files actually are

- **`TFP GOV CBR DEC Message Specification v1.4.4`** — the message spec for
  the Declaration document (`TFB_WCO_DEC`), WCO Data Model 3.8. Defines 145
  fields with types, lengths, mandatory flags, and the code tables each field
  draws from.
- **`TFB_WCO_DEC_v1.4.4.xsd`** — the real schema. Target namespace
  `http://globaletrade.services/Declaration`. It **imports
  `TFB_Common_Types.xsd` (namespace `TFB_Common_Types`), which we do not
  have** — that is the "common types master work file" the government is
  withholding until we pass the sample-file gate.
- **`sample.xsd`** — despite the extension, this is **not a schema; it is a
  sample XML instance** (it matches the spec's §2.1.3 sample nearly verbatim).
  The gate is: produce an XML file like this one from our app.

## 2. Validation harness — proven working (2026-07-31)

We cannot fully validate without `TFB_Common_Types.xsd`, but structural
validation (element names, order, cardinality — everything
`TFB_WCO_DEC_v1.4.4.xsd` itself defines) works with a permissive stub in which
every `TFB-CMN:*` type accepts any text/children/attributes. Verified with
`xmllint`:

- The government sample **as delivered does NOT validate** — its root has no
  namespace, and the XSD requires `xmlns="http://globaletrade.services/Declaration"`
  (the `xmlns=""` resets on `DateTimeString` inside the sample are the tell
  that the real instances are namespace-qualified).
- With that one attribute added to `<Declaration>`, **the sample validates
  cleanly** against the XSD + stub.
- The sample's XML declaration says `encoding="utf-16"` but the file is UTF-8;
  the spec's own sample says UTF-8. Emit UTF-8.

Reproduce the stub (from a dir containing the XSD):

```python
import re
types = sorted(set(re.findall(r'TFB-CMN:([A-Za-z]+)', open('TFB_WCO_DEC_v1.4.4.xsd').read())))
out = ['<?xml version="1.0" encoding="utf-8"?>',
 '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="TFB_Common_Types" xmlns="TFB_Common_Types">']
for t in types:
    out.append(f'  <xs:complexType name="{t}" mixed="true"><xs:sequence>'
               '<xs:any minOccurs="0" maxOccurs="unbounded" processContents="skip"/></xs:sequence>'
               '<xs:anyAttribute processContents="skip"/></xs:complexType>')
out.append('</xs:schema>')
open('TFB_Common_Types.xsd','w').write('\n'.join(out))
```

```bash
xmllint --noout --schema TFB_WCO_DEC_v1.4.4.xsd our-declaration.xml
```

When the real `TFB_Common_Types.xsd` arrives, delete the stub and revalidate —
it will add length/pattern/enumeration checks the stub waves through.

## 3. Where our integration differs — architecture-level findings

These invalidate assumptions baked into `src/lib/beaip/production-client.ts`
and the campaign skill:

1. **The wire format is a WCO 3.8 XML document, not our JSON-ish payload in a
   SOAP wrapper.** `buildEnvelope()` currently serializes `BeaipDeclaration`
   wholesale as `bea:Payload` under a placeholder namespace. The real message
   is the `Declaration` document above. The production client's header claim
   that "only element names need adjusting" is wrong — we need a real mapping
   layer (`BeaipDeclaration` → WCO Declaration XML). The
   `BeaipClient`/`BeaipDeclaration` seam itself survives; only the client's
   serialization is obsolete.
2. **Transport is still unknown.** The integration steps put "communicate to
   endpoint" at step 4, *after* the file gate at steps 2–3. Nothing in these
   documents mentions SOAP, WSDL, or endpoints. Do not touch the SOAP plumbing
   until step 4 documentation arrives; the current gate is purely "produce a
   valid file".
3. **We do not transmit our computed amounts.** Spec §Declaration/DutyTaxFree:
   "For Incoming message this section is left blank — Customs Internal Use
   Only." Same for exchange-rate and local-currency tags marked "not required
   for incoming". Click2Clear computes duty/VAT itself and (per the sample's
   outbound form) returns amounts in `DutyTaxFee` keyed by item sequence
   (`QuotaOrderID`) plus declaration-level fees (`DPF`). Consequences:
   - Our engine's job shifts from "numbers we file" to "numbers we predict" —
     Gate 3's to-the-cent reconciliation happens against the *response*, not
     the request.
   - The campaign's Gate 0 question 7 is answered: **the message does not
     carry C13/C14/C17/C18 anywhere.** Declaration classification is
     `TypeCode` (Regime, code table `TTFB_SYS_REGIME`, sample value `4`) +
     declaration-level CPC group (`400`) + item-level CPC (`4000`). Our
     `DeclarationType` enum is a UI/domain label, not a wire field.
4. **`FunctionCode` gives us amendment/cancellation semantics for free**:
   9 = original, 5 = replace/amendment, 1 = cancellation — relevant to the
   duplicate-submission question (Gate 3) and not modeled today.

## 4. Field-by-field mapping (WCO element ↔ our field ↔ gap)

M = mandatory, C = conditional per the spec. "OK" means derivable from
existing data with only formatting.

### Declaration header

| Element | M/C | Our source | Gap |
|---|---|---|---|
| `FunctionalReferenceID` | M | `Shipment.shipmentNumber` (spec allows sender's unique ref) | OK |
| `FunctionCode` | M | constant `9` (original) | OK |
| `TypeCode` (Regime) | M | — | **GAP**: needs `TTFB_SYS_REGIME` worksheet; sample uses `4` |
| `DeclarationOffice/ID` | M | `CustomsOffice.code` (NAS/FPO/…) | **PARTIAL**: official codes look numeric (`01`); mapping needs the Port worksheet |
| `Submitter/ID` | M | — | **GAP**: needs broker Company Registration Number; `Organization` has only `tinNumber`/`licenseNumber` |
| `AcceptanceDateTime` | C | submission timestamp | OK (`yyyy-MM-dd HH:mm:ss`) |
| `TotalGrossMassMeasure` | C | `Shipment.grossWeightKg`, unitCode `KGM` | OK |
| `TotalPackageQuantity` | C | `Shipment.packageCount` | PARTIAL: `PackageType` enum → `TTFB_SYS_PACKAGE_UOM` mapping needed |
| `Declarant` | C | `Organization.name` + `tinNumber` | OK |
| `AdditionalDocument` (TIER/permits/uploads) | C | `ShipmentDocument` (has fileName/mime/size, bytes in S3) | PARTIAL: no base64 embed path, no hash, no OGA metadata |
| `AdditionalInformation` (dynamic fields) | C | — | GAP: needs `TTFB_SYS_DEC_FIELD_MASTER` worksheet |
| `PreviousDocument` | C | — | N/A (amendments only) |
| `GovernmentProcedure/CurrentCode` (CPC group) | C | derivable from line CPCs (`4000` → group `400`) | OK-ish |
| `DutyTaxFee` | — | omit (blank for incoming) | OK — do not send our totals |

### GoodsShipment

| Element | M/C | Our source | Gap |
|---|---|---|---|
| `Importer`, `Consignee` + `Address` | C | `Client.name`, `tinNumber`, `address` (single string) | **PARTIAL**: spec wants CityName/CountryCode/Line/PostcodeID; `Client` has no structured address or country |
| `Exporter`, `Consignor`, `Supplier` + `Address` | C | `Supplier.name`, `country`, `address` (single string) | PARTIAL: same structuring gap |
| `BorderTransportMeans` Name/TypeCode/Nationality/ArrivalDateTime | C | `manifest.voyage.vessel.name`, `TransportMode` enum, `voyage.arrivalDate` | PARTIAL: mode enum → `TTFB_SYS_TRANSPORT_MODE` codes; vessel nationality not stored |
| `BorderTransportMeans/TransportEquipment` (container, seal, fullness) | C | `Shipment.containerNumber` (one string) | PARTIAL: no seal/characteristic/fullness, single container only |
| `Consignment/ArrivalTransportMeans` | C | same vessel data | OK-ish |
| `Consignment/GoodsLocation` | C | — | GAP (location-of-goods code) |
| `Consignment/TransportContractDocument` BL (705) / Manifest (785) | C | `Shipment.blNumber`, `Manifest.manifestNumber` | OK |
| `Consignment/UnloadingLocation` + `ArrivalDateTime` | C | `voyage.journey.destinationPort.unLocode` (`BSNAS`), `voyage.arrivalDate` | OK |
| `Consignment/UnloadingLocation/Warehouse` | C | — | GAP (warehouse code; matters for C17-style regimes) |
| `EntryOffice` / `ExitOffice` | C | destination / origin port codes via `Journey` | OK |
| `ExportCountry` | C | origin port country or supplier country | PARTIAL (pick a rule) |
| `Destination/CountryCode` | C | constant `BS` for imports | OK |
| `CustomsValuation` (one per invoice, **same order as `Invoice` elements** — that ordering is the invoice linkage) | C | `Invoice.subTotal` + `currency` (77); freight/insurance/other are **shipment-level** (`freightCharge` etc.) | **PARTIAL**: charges not held per invoice; **no exchange-rate field exists anywhere** (77-amount is in invoice currency + `CurrencyExchange`) |
| `Invoice` ID/date | C | `Invoice.invoiceNumber`, `invoiceDate` | OK |
| `TradeTerms` (incoterm) | C | — | **GAP**: no incoterm field (spec table says `ConditionCode`, XSD says `LocationID` — follow the XSD) |
| `UCR` | C | `shipmentNumber` if wanted | OK (optional) |

### GovernmentAgencyGoodsItem (one per line item)

| Element | M/C | Our source | Gap |
|---|---|---|---|
| `Commodity/SequenceNumeric` | C | `LineItem.lineNumber` | OK |
| `Commodity/Description` | C | `description` | OK |
| `Commodity/ValueAmount` | C | `totalValue` + invoice `currency` | OK |
| `Commodity/CommercialDescription` | C | `commercialDescription` | OK |
| `Commodity/AdditionalDocument` (invoice link, 380) | C | parent `Invoice.invoiceNumber` | OK |
| `Commodity/AdditionalInformation` (alcohol %, COUNTRYGROUP…) | C | — | GAP: worksheet-dependent; **ties directly to the open excise-data gap** (chapters 22/87) |
| `Commodity/Classification/ID` + `IdentificationTypeCode=HS` | C | `hsCode` `"2208.30.00"` | **PARTIAL**: sample shows undotted 8-digit (`10113452`), length 11 — dotted vs undotted must be confirmed via `TCMS_TRF_HSCODE` worksheet |
| `Commodity/GoodsMeasure` gross/net/tariff-qty | C | `weightKg` (single — no gross/net split), `quantity` + `unit` | PARTIAL: UOM code mapping; decide gross-vs-net sourcing |
| `Commodity/ProductCharacteristics` (chassis, engine, make…) | C | — | GAP: vehicles only; no vehicle fields modeled |
| `Commodity/TransportEquipment` | C | `Shipment.containerNumber` | OK |
| `CustomsValuation` (item level) | C | `freightApportioned` (64), `insuranceApportioned` (67), `otherCostApportioned` (104), `cifValue` (`ExitToEntryChargeAmount`) | **OK — strongest match in the model**; the apportionment engine output maps 1:1 |
| `GovernmentProcedure/CurrentCode` (item CPC) | C | `cpcCode` (`4000`) | OK-ish: spec table says `4000`, sample says `40000` — confirm via CPC worksheet |
| `Origin/CountryCode` | C | `countryOfOrigin` | OK |
| `Packaging` (count + supplementary quantities) | C | shipment-level `packageCount` only | PARTIAL: no per-item packages |
| `PreviousDocument` | C | — | N/A (child declarations) |

## 5. Withheld reference data (needed before business validation, not before the file gate)

The spec names these worksheets/code tables we do not have: Regime, Port,
CPC_Code, Transport Mode, Cargo Status, UOM, Package UOM, Currency, Warehouse,
Document types, Container Type, Vehicle Make/Model, and
`TTFB_SYS_DEC_FIELD_MASTER` (dynamic fields), plus
`TFP_CODE_MASTER_v2.3_for_GOVCBR_Doc1.3.xlsx` and `TFB_Common_Types.xsd`.
Producing the sample file unlocks these (per the government's stated process).
Until then, hardcode sample-consistent placeholders and label them.

## 6. Proposed plan

**Phase 1 — pass the file gate — DONE 2026-07-31:**
1. ✅ `src/lib/beaip/wco-xml.ts` emits the namespaced `Declaration` document in
   exact XSD element order. `BeaipDeclaration` extended (parties, invoices,
   transport, per-line values/apportioned costs/CPC); mapping extracted to
   `src/server/services/declaration-mapper.ts`, shared by the submit path and
   the generator so the wire payload cannot drift. Labeled placeholders:
   Regime=`4`, Submitter falls back `licenseNumber → tinNumber → CRN-PENDING`,
   transport-mode + package-UOM code maps (UN/EDIFACT guesses) in `wco-xml.ts`.
2. ✅ `npm run wco:generate` (`scripts/generate-wco-declaration.ts`) generates
   from a calculated shipment and validates via `xmllint` against
   `docs/tfp/TFB_WCO_DEC_v1.4.4.xsd` + the committed common-types stub
   (`docs/tfp/TFB_Common_Types.xsd` — replace with the official file when it
   arrives). `tests/wco-xml.test.ts` pins ordering, namespace, DateTimeString
   convention, DutyTaxFee omission, and (when xmllint exists) full validation.
3. ✅ Deliverable generated and validated from the seeded demo shipment:
   `docs/tfp/generated/declaration-SHP-2026-00001.xml`. Item CIF values sum
   exactly to the shipment total (apportionment intact). **Before sending to
   the integration team**: replace `CRN-PENDING` with the real broker CR
   number (set `Organization.licenseNumber`) and sanity-check the office code
   (`NAS` vs the numeric codes the sample hints at).

**Phase 2 — after the worksheets arrive:** code-mapping tables (regime, office,
UOM, package UOM, transport mode), real `TFB_Common_Types.xsd` validation,
HS-code format confirmation.

**Phase 3 — schema changes (owner approval, `submit-schema-and-migrations`):**
structured addresses on Client/Supplier, invoice-level exchange rate +
per-invoice charges, incoterm, Organization CR number, optional per-item
packaging/net weight, vehicle characteristics if the brokerage handles
vehicles.

**Phase 4 —** rejoin the campaign skill at Gates 2–3 once endpoint/transport
documentation (steps 4–5) arrives; rewrite `production-client.ts`
serialization around `wco-xml.ts` at that point, not before.
