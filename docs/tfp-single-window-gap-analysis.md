# TFP Single Window (Click2Clear) — Gap Analysis

Written 2026-07-31. Sources: `TFP GOV CBR DEC Message Specification v1.4.4`
(CrimsonLogic, Jul 2020), `TFB_WCO_DEC_v1.4.4.xsd`, `sample.xsd`, all in
`~/Downloads/`; compared against the codebase at commit `b72bc45` and the
`submit-beaip-integration-campaign` skill. This doc is the Gate 2 "field-mapping
document" the campaign calls for, produced early because the spec arrived
before the WSDL.

> Updated 2026-08-08: this is the historical discovery analysis. The formal,
> implementation-aligned register is now
> [`docs/tfp/field-mapping-matrix.md`](tfp/field-mapping-matrix.md). Schema,
> mapping, calculation and UI gaps marked below have since been closed where
> the supplied documents permit; withheld government code masters remain open.
>
> Updated 2026-08-17: stakeholder decisions now supersede several historical
> rows below. Review XML uses Click2Clear-shaped declaration and trader
> references, `NASACP`, `Atlas Brokers`, gross pounds (`LB`), undotted HS IDs,
> no optional `BorderTransportMeans`, and one invoice-level landed-cost freight
> amount. See the formal matrix for the current rules.

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

1. **The wire format is a WCO 3.8 XML document, not a guessed SOAP payload.**
   The hypothetical SOAP production client, mock submission, status polling,
   and environment cutover flag were removed on 2026-08-08. The supported
   workflow is now shipment → preflight → versioned WCO XML review artifact.
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
4. **`FunctionCode` supports amendment/cancellation semantics, but the current
   workflow intentionally emits originals only**: 9 = original. Values 5
   (replace/amendment) and 1 (cancellation) require a separately designed and
   certified workflow before they may be exposed.

## 4. Field-by-field mapping (WCO element ↔ our field ↔ gap)

M = mandatory, C = conditional per the spec. "OK" means derivable from
existing data with only formatting.

### Declaration header

| Element | M/C | Our source | Gap |
|---|---|---|---|
| `FunctionalReferenceID` | M | `Shipment.shipmentNumber` (spec allows sender's unique ref) | OK |
| `FunctionCode` | M | constant `9` | MAPPED as original; no per-entry override |
| `TypeCode` (Regime) | M | `Shipment.regimeCode` | **PARTIAL**: stored/editable; needs `TTFB_SYS_REGIME` worksheet; sample uses `4` |
| `DeclarationOffice/ID` | M | `CustomsOffice.code` (NAS/FPO/…) | **PARTIAL**: official codes look numeric (`01`); mapping needs the Port worksheet |
| `Submitter/ID` | M | `BEAIP_BROKER_CODE` | MAPPED from the broker-confirmed filing code; distinct from WS-Security credentials |
| `AcceptanceDateTime` | C | submission timestamp | OK (`yyyy-MM-dd HH:mm:ss`) |
| `TotalGrossMassMeasure` | C | `Shipment.grossWeightKg`, unitCode `KGM` | OK |
| `TotalPackageQuantity` | C | `Shipment.packageCount` | Customs-confirmed QA mapping uses `unitCode=EA` |
| `Declarant` | C | Constant name + ID `20113855131249792` | Customs-confirmed QA identity |
| `AdditionalDocument` (TIER/permits/uploads) | C | `ShipmentDocument` (has fileName/mime/size, bytes in S3) | GAP: response requires Invoice and Tax Compliance Certificate; no declaration attachment serialization yet |
| `AdditionalInformation` (dynamic fields) | C | — | GAP: needs `TTFB_SYS_DEC_FIELD_MASTER` worksheet |
| `PreviousDocument` | C | — | N/A (amendments only) |
| `GovernmentProcedure/CurrentCode` (final declaration element) | C | import procedure | Customs-confirmed QA value `400` |
| `DutyTaxFee` | — | omit (blank for incoming) | OK — do not send our totals |

### GoodsShipment

| Element | M/C | Our source | Gap |
|---|---|---|---|
| `Importer`, `Consignee` + `Address` | C | `Client.name`, TIN, address/city/country/postcode | MAPPED |
| `Exporter`, `Consignor`, `Supplier` + `Address` | C | `Supplier` structured fields + exporter ID `20113855131249792` | Exporter/Supplier mapped for QA; Consignor remains conditional |
| `BorderTransportMeans` Name/TypeCode/Nationality/ArrivalDateTime | C | `manifest.voyage.vessel.name`, `TransportMode` enum, `voyage.arrivalDate` | PARTIAL: mode enum → `TTFB_SYS_TRANSPORT_MODE` codes; vessel nationality not stored |
| `BorderTransportMeans/TransportEquipment` (container, seal, fullness) | C | Shipment container/seal/fullness fields | MAPPED for one container; codes provisional |
| `Consignment/ArrivalTransportMeans` | C | same vessel data | OK-ish |
| `Consignment/GoodsLocation` | C | `DeclarationOffice/ID` | Customs-confirmed QA rule: same value as declaration office (`NASACP`) |
| `Consignment/TransportContractDocument` BL (705) / Manifest (785) | C | Not emitted | Customs-confirmed no-manifest QA submission |
| `Consignment/UnloadingLocation` + `ArrivalDateTime` | C | Constant `USPBI` + `voyage.arrivalDate` | Customs-confirmed QA place of discharge |
| `Consignment/UnloadingLocation/Warehouse` | C | `Shipment.warehouseCode` | MAPPED; code list withheld |
| `EntryOffice` / `ExitOffice` | C | destination port / constant `USPBI` | Exit office confirmed for current QA profile |
| `ExportCountry` | C | origin port country or supplier country | PARTIAL (pick a rule) |
| `Destination/CountryCode` | C | constant `BS` for imports | OK |
| `CustomsValuation` (one per invoice, **same order as `Invoice` elements** — that ordering is the invoice linkage) | C | Invoice subtotal/currency/exchange rate + line-level apportioned costs summed per invoice | MAPPED |
| `Invoice` ID/date | C | `Invoice.invoiceNumber`, `invoiceDate` | OK; optional `Invoice/TypeCode` is omitted per Customs feedback |
| `TradeTerms` (incoterm) | C | `Invoice.incotermCode` + `incotermLocation` | MAPPED following XSD sequence |
| `UCR` | C | Not emitted | Optional and absent from the supplied successful submission |

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
| `Commodity/GoodsMeasure` gross/net/tariff-qty | C | gross/net weights + frozen duty/excise assessment quantity/unit | Commercial `PCS` maps to Customs-confirmed `EA`; specific units are preserved |
| `Commodity/ProductCharacteristics` (chassis, engine, make…) | C | — | GAP: vehicles only; no vehicle fields modeled |
| `Commodity/TransportEquipment` | C | `Shipment.containerNumber` | OK |
| `CustomsValuation` (item level) | C | `otherCostApportioned` (104), `cifValue` (`ExitToEntryChargeAmount`) | `FreightChargeAmount` omitted per Customs feedback; shipment freight remains charge deduction 64 |
| `GovernmentProcedure/CurrentCode` (item CPC) | C | `cpcCode` (`400`) | Customs-confirmed standard import wire value `400000`; concession `4098` remains unconfirmed |
| `Origin/CountryCode` | C | `countryOfOrigin` | OK |
| `Packaging` (count + supplementary quantities) | C | per-item package count | Required for every goods item; Customs-confirmed `unitCode=EA` |
| `PreviousDocument` | C | — | N/A (child declarations) |

## 5. Withheld reference data (needed before business validation, not before the file gate)

The spec names these worksheets/code tables we do not have: Regime, Port,
CPC_Code, Transport Mode, Cargo Status, UOM, Package UOM, Currency, Warehouse,
Document types, Container Type, Vehicle Make/Model, and
`TTFB_SYS_DEC_FIELD_MASTER` (dynamic fields), plus
`TFP_CODE_MASTER_v2.3_for_GOVCBR_Doc1.3.xlsx` and `TFB_Common_Types.xsd`.
Producing the sample file unlocks these (per the government's stated process).
Until then, hardcode sample-consistent placeholders and label them.

## 6. Implementation status and next gate

**Phase 1 — pass the file gate — implemented:**
1. ✅ `src/lib/beaip/wco-xml.ts` emits the namespaced `Declaration` document in
   exact XSD element order. `BeaipDeclaration` extended (parties, invoices,
   transport, per-line values/apportioned costs/CPC); mapping extracted to
   `src/server/services/declaration-mapper.ts`, shared by the submit path and
   the generator so the wire payload cannot drift. Labeled placeholders:
   Regime=`4`; Submitter uses the server-only `BEAIP_BROKER_CODE`; the
   transport-mode code map remains provisional in `wco-xml.ts`.
2. ✅ `npm run wco:generate` (`scripts/generate-wco-declaration.ts`) generates
   from a calculated shipment and validates via `xmllint` against
   `docs/tfp/TFB_WCO_DEC_v1.4.4.xsd` + the committed common-types stub
   (`docs/tfp/TFB_Common_Types.xsd` — replace with the official file when it
   arrives). `tests/wco-xml.test.ts` pins ordering, namespace, DateTimeString
   convention, DutyTaxFee omission, and (when xmllint exists) full validation.
3. ✅ Deliverable generated and validated from the seeded demo shipment:
   `docs/tfp/generated/declaration-SHP-2026-00001.xml`. Item CIF values sum
   exactly to the shipment total (apportionment intact). **Before sending to
   the integration team**: confirm the configured submitter ID; the current QA
   declaration/declarant/exporter profile uses `20113855131249792` where noted.

**Phase 2 — after the worksheets arrive:** remaining code-mapping tables
(regime, office, non-`PCS` UOM, transport mode and concession CPC), real
`TFB_Common_Types.xsd` validation, and full HS-code format confirmation.

**Phase 3 — schema/UI/calculation changes — implemented 2026-08-08 except
vehicle characteristics:** structured addresses, invoice exchange rate and
incoterms, organization CR number, per-item packaging/net weight, independent
duty/excise bases, effective-dated rate sources, alcohol assessment quantities,
and a declaration-profile UI.

**Phase 4 — active QA:** the owner-directed SOAP adapter persists every attempt
before transmission and never retries automatically. Customs' corrected body
created provisional UAT draft `PROV20260000020299`; Invoice and Tax Compliance
Certificate attachments are still required. Production activation remains
prohibited until UAT certification and explicit owner go-live approval.
