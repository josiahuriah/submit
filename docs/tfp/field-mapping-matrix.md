# TFP v1.4.4 declaration field-mapping matrix

- Status: implementation baseline for Customs stakeholder review
- Schema: `TFB_WCO_DEC_v1.4.4`
- Namespace: `http://globaletrade.services/Declaration`
- Executable register: `src/lib/beaip/tfp-field-mapping.ts`
- XML builder: `src/lib/beaip/wco-xml.ts`

This matrix governs the stakeholder-created incoming declaration XML. It does not claim that Click2Clear business validation is complete. The supplied XSD proves structure; Customs must still release the referenced code-master worksheets and confirm the conditional business rules.

## Status vocabulary

| Status | Meaning |
|---|---|
| `MAPPED` | Stored application data maps directly to the TFP element. |
| `DERIVED` | Deterministically calculated or copied from related records. |
| `CONDITIONAL` | Emitted only when its source data exists or the declaration case requires it. |
| `CONFIRMED_BY_BROKER` | Filing identity supplied by the broker for the current QA configuration. |
| `CONFIRMED_BY_CUSTOMS` | Corrected from written Customs feedback and accepted far enough to create a UAT draft. |
| `WITHHELD_CODE_LIST` | Structurally mapped, but the government code worksheet has not been supplied. |
| `NOT_MODELED` | The specification supports it, but Submit does not yet capture it. |
| `OMIT_INCOMING` | Intentionally excluded from stakeholder submissions. |

`M` and `C` below reproduce the supplied specification's mandatory and conditional classifications. `OUT` identifies response/internal-use content.

## Declaration and parties

| TFP element path | Req. | Submit source | Transform / rule | Status |
|---|---:|---|---|---|
| `Declaration/AcceptanceDateTime` | C | Artifact generation timestamp | TFP `DateTimeString`, local time | `DERIVED` |
| `Declaration/FunctionCode` | M | Constant `9` | Original declaration; cannot be overridden per entry | `DERIVED` |
| `Declaration/FunctionalReferenceID` | M | Declaration year + stable shipment sequence | `YYYYDEC##########` for review files; Click2Clear is expected to supply the live declaration number | `DERIVED` |
| `Declaration/TypeCode` | M | `Shipment.regimeCode` | Code value; default `4` is provisional | `WITHHELD_CODE_LIST` |
| `Declaration/TotalGrossMassMeasure` | C | `Shipment.grossWeightKg` | Convert kilograms to pounds; `unitCode=LB` | `DERIVED` |
| `Declaration/TotalPackageQuantity` | C | `Shipment.packageCount` | `unitCode=EA` | `CONFIRMED_BY_CUSTOMS` |
| `Declaration/Submitter/ID` | M | `BEAIP_BROKER_CODE` | Assigned BEAIP filing code; distinct from WS-Security username, Sender, TIN, and broker licence | `CONFIRMED_BY_BROKER` |
| `Declaration/DeclarationOffice/ID` | M | Constant `NASACP` | Interim value for all entries until the office master sheet is available | `DERIVED` |
| `Declaration/Declarant/Name` | C | Constant `Atlas Brokers` | Stakeholder-approved filing identity | `DERIVED` |
| `Declaration/Declarant/ID` | C | Constant `20113855131249792` | Current Customs QA filing identity | `CONFIRMED_BY_CUSTOMS` |
| `Declaration/PreviousDocument/ID` | C | Not modeled | Required for applicable amendments | `NOT_MODELED` |
| `Declaration/AdditionalDocument` | C | `ShipmentDocument` metadata exists | Bytes/code mapping still required | `NOT_MODELED` |
| `Declaration/AdditionalInformation` | C | Dynamic declaration data | Worksheet-driven qualifiers | `WITHHELD_CODE_LIST` |
| `Declaration/DutyTaxFee` | OUT | Click2Clear assessment | Never sent in incoming XML | `OMIT_INCOMING` |
| `GoodsShipment/Consignee` | C | `Client` | Name, TIN and structured address | `MAPPED` |
| `GoodsShipment/Importer` | C | `Client` | Name, TIN and structured address | `MAPPED` |
| `GoodsShipment/Exporter` | C | First invoice `Supplier` + constant ID `20113855131249792` | Supplier name/address with current Customs QA exporter ID | `CONFIRMED_BY_CUSTOMS` |
| `GoodsShipment/Supplier[]` | C | Each invoice `Supplier` | Same order as invoices | `MAPPED` |
| `GoodsShipment/Consignor` | C | Supplier candidate | Not emitted separately | `CONDITIONAL` |
| `GoodsShipment/Destination/CountryCode` | C | Bahamas destination | Constant `BS` | `DERIVED` |

## Transport and consignment

| TFP element path | Req. | Submit source | Transform / rule | Status |
|---|---:|---|---|---|
| `BorderTransportMeans/Name` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `BorderTransportMeans/TypeCode` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `BorderTransportMeans/RegistrationNationalityCode` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `BorderTransportMeans/ArrivalDateTime` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `BorderTransportMeans/TransportEquipment/FullnessCode` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `BorderTransportMeans/TransportEquipment/ID` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `BorderTransportMeans/TransportEquipment/Seal/ID` | C | Withheld | Omit the optional parent until the values are confirmed | `OMIT_INCOMING` |
| `GoodsShipment/EntryOffice/ID` | C | Destination `Port.unLocode` | Verbatim | `MAPPED` |
| `GoodsShipment/ExitOffice/ID` | C | Constant `USPBI` | Current QA place of discharge | `CONFIRMED_BY_CUSTOMS` |
| `GoodsShipment/ExportCountry/ID` | C | Origin port country, then supplier country | First available ISO alpha-2 | `DERIVED` |
| `Consignment/ArrivalTransportMeans/Name` | C | `Manifest.voyage.vessel.name` | Verbatim | `MAPPED` |
| `Consignment/ArrivalTransportMeans/TypeCode` | C | `Shipment.transportMode` | Provisional `SEA=1`, `AIR=4` | `WITHHELD_CODE_LIST` |
| `Consignment/ArrivalTransportMeans/RegistrationNationalityCode` | C | `Shipment.transportNationalityCode` | ISO alpha-2 | `MAPPED` |
| `Consignment/GoodsLocation/ID` | C | `DeclarationOffice/ID` | Same value as the declaration office (`NASACP`) | `CONFIRMED_BY_CUSTOMS` |
| `Consignment/TransportContractDocument[705]/ID` | C | `Shipment.blNumber` | Omit for the current no-manifest QA submission | `OMIT_INCOMING` |
| `Consignment/TransportContractDocument[785]/ID` | C | `Manifest.manifestNumber` | Omit for the current no-manifest QA submission | `OMIT_INCOMING` |
| `Consignment/UnloadingLocation/ID` | C | Constant `USPBI` | Current QA place of discharge | `CONFIRMED_BY_CUSTOMS` |
| `Consignment/UnloadingLocation/Warehouse/ID` | C | `Shipment.warehouseCode` | Verbatim | `WITHHELD_CODE_LIST` |

## Invoice and valuation

Invoice linkage is positional in TFP v1.4.4: shipment `CustomsValuation` nodes are emitted in exactly the same order as `Invoice` nodes. Each goods item also links to its commercial invoice through `AdditionalDocument` type `380`.

| TFP element path | Req. | Submit source | Transform / rule | Status |
|---|---:|---|---|---|
| `CustomsValuation/ChargeDeduction[77]` | C | `Invoice.subTotal`, `currency`, `exchangeRate` | Invoice amount; non-BSD rate included | `MAPPED` |
| `CustomsValuation/FreightChargeAmount` | C | Not emitted | Freight remains represented by `ChargeDeduction[64]` | `OMIT_INCOMING` |
| `CustomsValuation/ChargeDeduction[64]` | C | Sum all lines' apportioned freight | BSD; assign to the same first invoice valuation | `DERIVED` |
| `CustomsValuation/ChargeDeduction[67]` | C | Sum invoice lines' apportioned insurance | BSD | `DERIVED` |
| `CustomsValuation/ChargeDeduction[104]` | C | Sum invoice lines' apportioned other cost | BSD | `DERIVED` |
| `Invoice/ID` | C | `Invoice.invoiceNumber` | Verbatim | `MAPPED` |
| `Invoice/IssueDateTime` | C | `Invoice.invoiceDate` | TFP `DateTimeString` | `MAPPED` |
| `Invoice/TypeCode` | C | `Invoice.incotermCode` | Omit from `Invoice`; retain `TradeTerms/LocationID` when present | `OMIT_INCOMING` |
| `TradeTerms/LocationID` | C | `Invoice.incotermLocation` | Verbatim | `MAPPED` |
| `UCR/TraderAssignedReferenceID` | C | Declaration year + stable shipment sequence | `YYYY00OREF########` | `DERIVED` |

## Goods items

| TFP element path | Req. | Submit source | Transform / rule | Status |
|---|---:|---|---|---|
| `Commodity/SequenceNumeric` | C | Item position | One-based across the declaration | `DERIVED` |
| `Commodity/Description` | C | `LineItem.description` | Verbatim | `MAPPED` |
| `Commodity/ValueAmount` | C | `LineItem.totalValue`, invoice currency | `currencyID` attribute | `MAPPED` |
| `Commodity/CommercialDescription` | C | `LineItem.commercialDescription` | Verbatim | `CONDITIONAL` |
| `Commodity/AdditionalDocument` | C | `Invoice.invoiceNumber` | `TypeCode=380` | `DERIVED` |
| `Commodity/AdditionalInformation` | C | Alcohol/dynamic fields | Qualifier mapping pending | `WITHHELD_CODE_LIST` |
| `Commodity/Classification/ID` | C | `LineItem.hsCode` | Remove periods for the 8-digit wire value | `DERIVED` |
| `Commodity/Classification/IdentificationTypeCode` | C | HS classification | Constant `HS` | `DERIVED` |
| `Commodity/GoodsMeasure/GrossMassMeasure` | C | `LineItem.weightKg` | `unitCode=KGM` | `MAPPED` |
| `Commodity/GoodsMeasure/NetNetWeightMeasure` | C | `LineItem.netWeightKg` | `unitCode=KGM` | `MAPPED` |
| `Commodity/GoodsMeasure/TariffQuantity` | C | Frozen assessment quantity | Duty quantity, then excise quantity, then commercial quantity; map `PCS` to `EA` and preserve specific assessment units | `CONFIRMED_BY_CUSTOMS` |
| `Commodity/ProductCharacteristics` | C | Vehicle-specific fields | Not captured | `NOT_MODELED` |
| `Commodity/TransportEquipment/ID` | C | `Shipment.containerNumber` | Verbatim | `MAPPED` |
| `GoodsItem/CustomsValuation/ExitToEntryChargeAmount` | C | `LineItem.cifValue` | BSD | `MAPPED` |
| `GoodsItem/CustomsValuation/FreightChargeAmount` | C | Not emitted | Omit from goods-item valuation | `OMIT_INCOMING` |
| `GoodsItem/CustomsValuation/InsuranceAmount` | C | `LineItem.insuranceApportioned` | BSD | `MAPPED` |
| `GoodsItem/CustomsValuation/ChargeDeduction[104]` | C | `LineItem.otherCostApportioned` | BSD | `MAPPED` |
| `GoodsItem/GovernmentProcedure/CurrentCode` | C | `LineItem.cpcCode` | Standard CPC `400` becomes `40000` on the wire | `CONFIRMED_BY_CUSTOMS` |
| `GoodsItem/Origin/CountryCode` | C | `LineItem.countryOfOrigin` | ISO alpha-2 | `MAPPED` |
| `GoodsItem/Packaging/QuantityQuantity` | C | `LineItem.packageCount` | Required for every goods item; `unitCode=EA` | `CONFIRMED_BY_CUSTOMS` |
| `Declaration/GovernmentProcedure/CurrentCode` | C | Import procedure | Constant `40000` | `CONFIRMED_BY_CUSTOMS` |

## Generation gates and unresolved government dependencies

Artifact generation blocks on a current calculation, declaration reference/function/regime/office, positive shipment and per-item package counts, importer, invoice, goods item, full HS code, valid CPC, item description, and invoice linkage. It records the schema version, mapping version, generation time, validation report, and exact XML in a `DRAFT` `CustomsEntry` without submitting it. `VALIDATED` is deliberately reserved for a future pass against the official common-types schema, not the permissive structural-validation stub.

The following remain provisional until Customs releases the associated worksheets or confirms them during UAT:

- regime codes (`TTFB_SYS_REGIME`);
- warehouse, transport-mode, fullness, non-`PCS` tariff UOMs and concession CPC `4098`;
- dynamic additional-information qualifiers, documents, exemptions and vehicle characteristics;
- endpoint envelope, authentication, acknowledgement and business-rejection semantics.

Customs' corrected-body review created UAT provisional declaration
`PROV20260000020299`. Its response still requires Invoice and Tax Compliance
Certificate attachments. Declaration-level attachment payloads and official
document-code handling remain `NOT_MODELED`; the provisional number does not by
itself establish a successful filing.

The TFP specification makes `Declaration/Submitter/ID` mandatory. The broker
confirmed that this value is the assigned `BEAIP_BROKER_CODE`. Submit keeps it
separate from the WS-Security username, MessageHeader sender, organization TIN,
company registration number, and individual broker licence. The supplied
`sample.xsd` is an XML instance despite its extension. It omits the root
namespace, but the actual XSD declares a target namespace with
`elementFormDefault="qualified"`; generated declarations therefore retain
`xmlns="http://globaletrade.services/Declaration"` so they validate.
