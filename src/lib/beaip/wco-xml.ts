/**
 * WCO 3.8 Declaration XML builder for the TFP Single Window (Click2Clear).
 *
 * Emits the TFB_WCO_DEC v1.4.4 document from a BeaipDeclaration. Element
 * names, ordering and cardinality follow docs/tfp/TFB_WCO_DEC_v1.4.4.xsd
 * exactly — child order inside every complex type is a validation error if
 * wrong, so the object literals below are written in schema order and must
 * stay that way.
 *
 * Spec facts this file encodes (see docs/tfp-single-window-gap-analysis.md):
 *   - The root MUST carry xmlns="http://globaletrade.services/Declaration";
 *     the government's own sample omits it and fails its own XSD.
 *   - DateTimeString children are unqualified (xmlns="") with the spec's
 *     formatCode "yyyy-MM-dd HH:mm:ss " (trailing space verbatim from spec).
 *   - DutyTaxFee is NOT sent: "For Incoming message this section is left
 *     blank — Customs Internal Use Only". Click2Clear computes amounts.
 *   - Shipment-level CustomsValuation elements must appear in the same order
 *     as the Invoice elements — that ordering IS the invoice linkage.
 *
 * PLACEHOLDER code maps (transport mode, package UOM) are best-guess UN/EDIFACT
 * values pending the withheld TFP code-master worksheets; each is labeled.
 */
import { XMLBuilder } from 'fast-xml-parser'
import type {
  BeaipDeclaration,
  BeaipDeclarationLine,
  BeaipInvoice,
  BeaipParty,
} from './types'
import { d, moneyString, sum } from '@/lib/calculations/money'
import { normalizeHsCode, STANDARD_IMPORT_CPC } from '@/lib/customs/normalization'

export const WCO_DECLARATION_NS = 'http://globaletrade.services/Declaration'

/** EDIFACT 1225 function codes: 9 original, 5 amendment, 1 cancellation. */
export type WcoFunctionCode = '9' | '5' | '1'

// PLACEHOLDER (UN/ECE Rec 19) until the Transport Mode worksheet arrives.
const TRANSPORT_MODE_CODES: Record<string, string> = {
  SEA: '1',
  AIR: '4',
  LAND: '3',
}

// PLACEHOLDER (UN/EDIFACT Rec 21) until the Package UOM worksheet arrives.
const PACKAGE_UOM_CODES: Record<string, string> = {
  CONTAINER: 'CN',
  PALLET: 'PX',
  CARTON: 'CT',
  CRATE: 'CR',
  DRUM: 'DR',
  BUNDLE: 'BE',
  LOOSE: 'NE',
  VEHICLE: 'VN',
  OTHER: 'PK',
}

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  format: true,
  indentBy: '    ',
})

function formatDateTime(iso: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Nassau', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}

/** DateTimeType — unqualified DateTimeString child, spec formatCode verbatim. */
function dt(iso: string | Date) {
  return {
    DateTimeString: {
      '#text': formatDateTime(iso),
      '@_xmlns': '',
      '@_formatCode': 'yyyy-MM-dd HH:mm:ss ',
    },
  }
}

/** AmountCurrencyType — value with a currencyID attribute. */
function amt(value: string, currency: string) {
  return { '#text': value, '@_currencyID': currency }
}

/** PartyType in schema order: Name, ID, Address(CityName, CountryCode, Line, PostcodeID). */
function party(p: BeaipParty) {
  const a = p.address
  const hasAddress = a && (a.cityName || a.countryCode || a.line || a.postcode)
  return {
    Name: p.name,
    ...(p.id ? { ID: p.id } : {}),
    ...(hasAddress
      ? {
          Address: {
            ...(a.cityName ? { CityName: a.cityName } : {}),
            ...(a.countryCode ? { CountryCode: a.countryCode } : {}),
            ...(a.line ? { Line: a.line.slice(0, 70) } : {}),
            ...(a.postcode ? { PostcodeID: a.postcode } : {}),
          },
        }
      : {}),
  }
}

/**
 * ChargeDeduction — insurance is deliberately not represented. Click2Clear's
 * operational rule requires insurance to be folded into freight.
 */
function chargeDeduction(code: string, amount: string, currency: string, exchangeRate?: string) {
  return {
    ChargesTypeCode: code,
    OtherChargeDeductionAmount: amount,
    CurrencyExchange: {
      CurrencyTypeCode: currency,
      ...(exchangeRate && currency !== 'BSD' ? { RateNumeric: exchangeRate } : {}),
    },
  }
}

function isNonZero(money: string): boolean {
  return !d(money).isZero()
}

/** Shipment-level CustomsValuation for one invoice (order-linked to Invoice). */
function invoiceValuation(inv: BeaipInvoice, freightAmount: string) {
  return {
    ...(isNonZero(freightAmount)
      ? { FreightChargeAmount: amt(freightAmount, 'BSD') }
      : {}),
    ChargeDeduction: [
      chargeDeduction('77', inv.subTotal, 'BSD'),
      ...(isNonZero(freightAmount)
        ? [chargeDeduction('64', freightAmount, 'BSD')]
        : []),
      ...(isNonZero(inv.otherApportioned)
        ? [chargeDeduction('104', inv.otherApportioned, 'BSD')]
        : []),
    ],
  }
}

/** GovernmentAgencyGoodsItem — one per line item, schema order throughout. */
function goodsItem(line: BeaipDeclarationLine, sequence: number, containerNumber: string | null) {
  const tariffQuantity = line.dutyAssessmentQuantity
    ? { value: line.dutyAssessmentQuantity, unit: line.dutyAssessmentUnit }
    : line.exciseAssessmentQuantity
      ? { value: line.exciseAssessmentQuantity, unit: line.exciseAssessmentUnit }
      : { value: line.quantity, unit: line.unit }
  return {
    Commodity: {
      SequenceNumeric: sequence,
      Description: line.description,
      ValueAmount: amt(line.totalValue, 'BSD'),
      ...(line.commercialDescription
        ? { CommercialDescription: line.commercialDescription }
        : {}),
      AdditionalDocument: { ID: line.invoiceNumber, TypeCode: '380' }, // 380 = commercial invoice
      Classification: { ID: normalizeHsCode(line.hsCode), IdentificationTypeCode: 'HS' },
      GoodsMeasure: {
        ...(line.weightLb
          ? { GrossMassMeasure: { '#text': line.weightLb, '@_unitCode': 'LB' } }
          : {}),
        ...(line.netWeightLb
          ? { NetNetWeightMeasure: { '#text': line.netWeightLb, '@_unitCode': 'LB' } }
          : {}),
        TariffQuantity: {
          '#text': tariffQuantity.value,
          '@_unitCode': tariffQuantity.unit ?? line.unit,
        },
      },
      ...(containerNumber ? { TransportEquipment: { ID: containerNumber } } : {}),
    },
    CustomsValuation: {
      ExitToEntryChargeAmount: amt(line.cifValue, 'BSD'), // item customs value
      ...(isNonZero(line.freightApportioned)
        ? { FreightChargeAmount: amt(line.freightApportioned, 'BSD') }
        : {}),
      ...(isNonZero(line.otherApportioned)
        ? { ChargeDeduction: chargeDeduction('104', line.otherApportioned, 'BSD') }
        : {}),
    },
    GovernmentProcedure: { CurrentCode: line.cpcCode },
    ...(line.countryOfOrigin ? { Origin: { CountryCode: line.countryOfOrigin } } : {}),
    ...(line.packageCount
      ? {
          Packaging: {
            SequenceNumeric: sequence,
            QuantityQuantity: {
              '#text': line.packageCount,
              '@_unitCode': line.packageTypeCode ?? 'PK',
            },
          },
        }
      : {}),
  }
}

export interface WcoXmlOptions {
  /** EDIFACT 1225: 9 original (default), 5 amendment, 1 cancellation. */
  functionCode?: WcoFunctionCode
  /** AcceptanceDateTime; defaults to now. Injectable for deterministic tests. */
  acceptanceDateTime?: Date
}

/**
 * Build the full TFB_WCO_DEC declaration document as a UTF-8 XML string.
 * Validate the output with `npx tsx scripts/generate-wco-declaration.ts` or
 * xmllint against docs/tfp/TFB_WCO_DEC_v1.4.4.xsd.
 */
export function buildWcoDeclarationXml(
  declaration: BeaipDeclaration,
  options: WcoXmlOptions = {},
): string {
  const d = declaration
  const t = d.transport
  const acceptance = options.acceptanceDateTime ?? new Date()
  const totalInvoiceFreight = moneyString(
    sum(declaration.invoices.map((invoice) => invoice.freightApportioned)),
  )

  const transportContractDocuments = [
    ...(d.blNumber ? [{ ID: d.blNumber, TypeCode: '705' }] : []), // 705 = bill of lading
    ...(t.manifestNumber ? [{ ID: t.manifestNumber, TypeCode: '785' }] : []), // 785 = manifest
  ]

  const cpcGroup = d.lines.length > 0 ? STANDARD_IMPORT_CPC : null

  const doc = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    Declaration: {
      '@_xmlns': WCO_DECLARATION_NS,
      AcceptanceDateTime: dt(acceptance),
      FunctionCode: options.functionCode ?? d.functionCode,
      FunctionalReferenceID: d.functionalReferenceId,
      TypeCode: d.regimeCode,
      ...(d.grossWeightLb
        ? {
            TotalGrossMassMeasure: {
              '#text': d.grossWeightLb,
              '@_unitCode': 'LB',
            },
          }
        : {}),
      TotalPackageQuantity: {
        '#text': d.packageCount,
        '@_unitCode': PACKAGE_UOM_CODES[d.packageUom] ?? 'PK',
      },
      Submitter: { ID: d.submitterId },
      DeclarationOffice: { ID: d.customsOfficeCode },
      // BorderTransportMeans is optional and intentionally omitted until its values are confirmed.
      Declarant: { Name: d.declarant.name, ...(d.declarant.id ? { ID: d.declarant.id } : {}) },
      // DutyTaxFee deliberately omitted — blank for incoming messages.
      GoodsShipment: {
        Consignee: party(d.consignee),
        Consignment: {
          ...(t.vesselName || t.transportMode
            ? {
                ArrivalTransportMeans: {
                  ...(t.vesselName ? { Name: t.vesselName } : {}),
                  ...(t.transportMode
                    ? { TypeCode: TRANSPORT_MODE_CODES[t.transportMode] ?? t.transportMode }
                    : {}),
                  ...(t.transportNationalityCode
                    ? { RegistrationNationalityCode: t.transportNationalityCode }
                    : {}),
                },
              }
            : {}),
          ...(t.goodsLocationCode ? { GoodsLocation: { ID: t.goodsLocationCode } } : {}),
          ...(transportContractDocuments.length > 0
            ? { TransportContractDocument: transportContractDocuments }
            : {}),
          ...(t.unloadingPortCode
            ? {
                UnloadingLocation: {
                  ID: t.unloadingPortCode,
                  ...(t.arrivalDate ? { ArrivalDateTime: dt(t.arrivalDate) } : {}),
                  ...(t.warehouseCode ? { Warehouse: { ID: t.warehouseCode } } : {}),
                },
              }
            : {}),
        },
        // One CustomsValuation per invoice, in Invoice element order (linkage).
        CustomsValuation: d.invoices.map((invoice, index) =>
          // Landed-cost freight belongs to one invoice valuation. Invoice
          // ordering is the XSD-defined linkage, so use the first invoice.
          invoiceValuation(invoice, index === 0 ? totalInvoiceFreight : '0.00'),
        ),
        Destination: { CountryCode: 'BS' },
        ...(t.entryPortCode ? { EntryOffice: { ID: t.entryPortCode } } : {}),
        ...(t.exitPortCode ? { ExitOffice: { ID: t.exitPortCode } } : {}),
        ...(t.exportCountryCode ? { ExportCountry: { ID: t.exportCountryCode } } : {}),
        ...(d.invoices[0] ? { Exporter: party(d.invoices[0].supplier) } : {}),
        GovernmentAgencyGoodsItem: d.lines.map((line, i) =>
          goodsItem(line, i + 1, t.containerNumber),
        ),
        Importer: party(d.importer),
        Invoice: d.invoices.map((inv) => ({
          ID: inv.invoiceNumber,
          ...(inv.invoiceDate ? { IssueDateTime: dt(inv.invoiceDate) } : {}),
          ...(inv.incotermCode ? { TypeCode: inv.incotermCode } : {}),
        })),
        Supplier: d.invoices.map((inv) => party(inv.supplier)),
        TradeTerms: d.invoices
          .filter((inv) => inv.incotermLocation)
          .map((inv) => ({ LocationID: inv.incotermLocation! })),
        UCR: { TraderAssignedReferenceID: d.brokerReference },
      },
      ...(cpcGroup ? { GovernmentProcedure: { CurrentCode: cpcGroup } } : {}),
    },
  }

  return builder.build(doc) as string
}
