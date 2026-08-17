/**
 * Executable TFP v1.4.4 field-mapping register.
 *
 * This is the code counterpart to docs/tfp/field-mapping-matrix.md. It keeps
 * required-field preflight beside the XML builder so a declaration cannot be
 * called "review ready" merely because it is well-formed XML. Code-master
 * dependencies remain warnings until Customs releases the official sheets.
 */
import type { BeaipDeclaration } from './types'
import { TFP_DECLARANT_NAME, TFP_DECLARATION_OFFICE_CODE } from './constants'

export const TFP_SCHEMA_VERSION = 'TFB_WCO_DEC_v1.4.4'
export const TFP_MAPPING_VERSION = 'submit-tfp-map-1.1.0'

export type TfpRequirement = 'M' | 'C' | 'OUTBOUND_ONLY'
export type TfpMappingStatus =
  | 'MAPPED'
  | 'DERIVED'
  | 'CONDITIONAL'
  | 'WITHHELD_CODE_LIST'
  | 'NOT_MODELED'
  | 'OMIT_INCOMING'

export interface TfpFieldMapping {
  section: string
  element: string
  requirement: TfpRequirement
  source: string
  transform: string
  status: TfpMappingStatus
  note?: string
}

export const TFP_FIELD_MAPPINGS: readonly TfpFieldMapping[] = [
  { section: 'Declaration', element: 'AcceptanceDateTime', requirement: 'C', source: 'artifact generation time', transform: 'yyyy-MM-dd HH:mm:ss', status: 'DERIVED' },
  { section: 'Declaration', element: 'FunctionCode', requirement: 'M', source: 'constant 9', transform: 'original declaration', status: 'DERIVED' },
  { section: 'Declaration', element: 'FunctionalReferenceID', requirement: 'M', source: 'Shipment.shipmentNumber + declaration year', transform: 'YYYYDEC + 10-digit stable sequence', status: 'DERIVED', note: 'Temporary review-file value; live Click2Clear integration is expected to supply the declaration number' },
  { section: 'Declaration', element: 'TypeCode', requirement: 'M', source: 'Shipment.regimeCode', transform: 'verbatim', status: 'WITHHELD_CODE_LIST', note: 'TTFB_SYS_REGIME not released; sample uses 4' },
  { section: 'Declaration', element: 'TotalGrossMassMeasure', requirement: 'C', source: 'Shipment.grossWeightKg', transform: 'convert KGM to LB; unitCode=LB', status: 'DERIVED' },
  { section: 'Declaration', element: 'TotalPackageQuantity', requirement: 'C', source: 'Shipment.packageCount/packageType', transform: 'package UOM map', status: 'WITHHELD_CODE_LIST' },
  { section: 'Declaration', element: 'Submitter/ID', requirement: 'M', source: 'constant 131249792', transform: 'configured company registration number', status: 'DERIVED' },
  { section: 'Declaration', element: 'DeclarationOffice/ID', requirement: 'M', source: 'constant NASACP', transform: 'stakeholder-approved interim office', status: 'DERIVED' },
  { section: 'Declaration', element: 'Declarant/Name', requirement: 'C', source: 'constant Atlas Brokers', transform: 'stakeholder-approved filing identity', status: 'DERIVED' },
  { section: 'Declaration', element: 'Declarant/ID', requirement: 'C', source: 'Organization.tinNumber', transform: 'verbatim', status: 'MAPPED' },
  { section: 'Declaration', element: 'PreviousDocument/ID', requirement: 'C', source: 'not modeled', transform: 'amendments only', status: 'NOT_MODELED' },
  { section: 'Declaration', element: 'AdditionalDocument', requirement: 'C', source: 'ShipmentDocument', transform: 'base64/hash metadata', status: 'NOT_MODELED', note: 'Object bytes and official document codes are not yet available' },
  { section: 'Declaration', element: 'AdditionalInformation', requirement: 'C', source: 'dynamic declaration fields', transform: 'worksheet driven', status: 'WITHHELD_CODE_LIST' },
  { section: 'Declaration', element: 'DutyTaxFee', requirement: 'OUTBOUND_ONLY', source: 'Customs assessment response', transform: 'none', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans', element: 'Name', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans', element: 'TypeCode', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans', element: 'RegistrationNationalityCode', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans', element: 'ArrivalDateTime', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans.TransportEquipment', element: 'FullnessCode', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans.TransportEquipment', element: 'ID', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'BorderTransportMeans.TransportEquipment', element: 'Seal/ID', requirement: 'C', source: 'withheld', transform: 'omit optional parent until confirmed', status: 'OMIT_INCOMING' },
  { section: 'GoodsShipment', element: 'Consignee', requirement: 'C', source: 'Client', transform: 'party/address mapping', status: 'MAPPED' },
  { section: 'GoodsShipment', element: 'Consignor', requirement: 'C', source: 'Supplier', transform: 'not emitted separately', status: 'CONDITIONAL' },
  { section: 'GoodsShipment', element: 'Destination/CountryCode', requirement: 'C', source: 'constant BS', transform: 'ISO alpha-2', status: 'DERIVED' },
  { section: 'GoodsShipment', element: 'EntryOffice/ID', requirement: 'C', source: 'Journey.destinationPort.unLocode', transform: 'verbatim', status: 'MAPPED' },
  { section: 'GoodsShipment', element: 'ExitOffice/ID', requirement: 'C', source: 'Journey.originPort.unLocode', transform: 'verbatim', status: 'MAPPED' },
  { section: 'GoodsShipment', element: 'ExportCountry/ID', requirement: 'C', source: 'origin port country or supplier country', transform: 'first available ISO alpha-2', status: 'DERIVED' },
  { section: 'Consignment', element: 'GoodsLocation/ID', requirement: 'C', source: 'Shipment.goodsLocationCode', transform: 'verbatim', status: 'WITHHELD_CODE_LIST' },
  { section: 'Consignment', element: 'ArrivalTransportMeans/Name', requirement: 'C', source: 'Manifest.voyage.vessel.name', transform: 'verbatim', status: 'MAPPED' },
  { section: 'Consignment', element: 'ArrivalTransportMeans/TypeCode', requirement: 'C', source: 'Shipment.transportMode', transform: 'SEA=1 AIR=4 provisional', status: 'WITHHELD_CODE_LIST' },
  { section: 'Consignment', element: 'ArrivalTransportMeans/RegistrationNationalityCode', requirement: 'C', source: 'Shipment.transportNationalityCode', transform: 'ISO alpha-2', status: 'MAPPED' },
  { section: 'Consignment', element: 'TransportContractDocument[705]/ID', requirement: 'C', source: 'Shipment.blNumber', transform: 'TypeCode=705', status: 'MAPPED' },
  { section: 'Consignment', element: 'TransportContractDocument[785]/ID', requirement: 'C', source: 'Manifest.manifestNumber', transform: 'TypeCode=785', status: 'MAPPED' },
  { section: 'Consignment', element: 'UnloadingLocation/ID', requirement: 'C', source: 'Journey.destinationPort.unLocode', transform: 'verbatim', status: 'MAPPED' },
  { section: 'Consignment', element: 'UnloadingLocation/Warehouse/ID', requirement: 'C', source: 'Shipment.warehouseCode', transform: 'verbatim', status: 'WITHHELD_CODE_LIST' },
  { section: 'GoodsShipment.CustomsValuation', element: 'ChargeDeduction[77]', requirement: 'C', source: 'Invoice.subTotal/currency/exchangeRate', transform: 'invoice order is linkage', status: 'MAPPED' },
  { section: 'GoodsShipment.CustomsValuation', element: 'FreightChargeAmount', requirement: 'C', source: 'sum all LineItem.freightApportioned', transform: 'BSD; assign to first invoice valuation', status: 'DERIVED' },
  { section: 'GoodsShipment.CustomsValuation', element: 'ChargeDeduction[64]', requirement: 'C', source: 'sum all LineItem.freightApportioned', transform: 'BSD; assign to first invoice valuation', status: 'DERIVED' },
  { section: 'GoodsShipment.CustomsValuation', element: 'ChargeDeduction[67]', requirement: 'C', source: 'sum LineItem.insuranceApportioned by invoice', transform: 'BSD', status: 'DERIVED' },
  { section: 'GoodsShipment.CustomsValuation', element: 'ChargeDeduction[104]', requirement: 'C', source: 'sum LineItem.otherCostApportioned by invoice', transform: 'BSD', status: 'DERIVED' },
  { section: 'Invoice', element: 'ID', requirement: 'C', source: 'Invoice.invoiceNumber', transform: 'verbatim', status: 'MAPPED' },
  { section: 'Invoice', element: 'IssueDateTime', requirement: 'C', source: 'Invoice.invoiceDate', transform: 'TFP DateTimeType', status: 'MAPPED' },
  { section: 'Invoice', element: 'TypeCode', requirement: 'C', source: 'Invoice.incotermCode', transform: 'verbatim', status: 'MAPPED' },
  { section: 'TradeTerms', element: 'LocationID', requirement: 'C', source: 'Invoice.incotermLocation', transform: 'verbatim', status: 'MAPPED' },
  { section: 'UCR', element: 'TraderAssignedReferenceID', requirement: 'C', source: 'Shipment.shipmentNumber + declaration year', transform: 'YYYY00OREF + 8-digit stable sequence', status: 'DERIVED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/SequenceNumeric', requirement: 'C', source: 'generated item sequence', transform: '1-based across declaration', status: 'DERIVED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/Description', requirement: 'C', source: 'LineItem.description', transform: 'verbatim', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/ValueAmount', requirement: 'C', source: 'LineItem.totalValue + Invoice.currency', transform: 'currencyID attribute', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/CommercialDescription', requirement: 'C', source: 'LineItem.commercialDescription', transform: 'verbatim', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/AdditionalDocument', requirement: 'C', source: 'Invoice.invoiceNumber', transform: 'TypeCode=380', status: 'DERIVED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/AdditionalInformation', requirement: 'C', source: 'alcohol/dynamic fields', transform: 'worksheet driven', status: 'WITHHELD_CODE_LIST' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/Classification/ID', requirement: 'C', source: 'LineItem.hsCode', transform: 'remove periods for 8-digit wire value', status: 'DERIVED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/Classification/IdentificationTypeCode', requirement: 'C', source: 'constant HS', transform: 'verbatim', status: 'DERIVED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/GoodsMeasure/GrossMassMeasure', requirement: 'C', source: 'LineItem.weightKg', transform: 'unitCode=KGM', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/GoodsMeasure/NetNetWeightMeasure', requirement: 'C', source: 'LineItem.netWeightKg', transform: 'unitCode=KGM', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/GoodsMeasure/TariffQuantity', requirement: 'C', source: 'frozen duty/excise assessment quantity', transform: 'specific-rate unit; commercial quantity fallback', status: 'DERIVED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/ProductCharacteristics', requirement: 'C', source: 'vehicle-specific data', transform: 'qualifier code pairs', status: 'NOT_MODELED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Commodity/TransportEquipment/ID', requirement: 'C', source: 'Shipment.containerNumber', transform: 'verbatim', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'CustomsValuation/ExitToEntryChargeAmount', requirement: 'C', source: 'LineItem.cifValue', transform: 'BSD', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'CustomsValuation/FreightChargeAmount', requirement: 'C', source: 'LineItem.freightApportioned', transform: 'BSD', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'CustomsValuation/InsuranceAmount', requirement: 'C', source: 'LineItem.insuranceApportioned', transform: 'BSD', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'CustomsValuation/ChargeDeduction[104]', requirement: 'C', source: 'LineItem.otherCostApportioned', transform: 'BSD', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'GovernmentProcedure/CurrentCode', requirement: 'C', source: 'LineItem.cpcCode', transform: 'verbatim', status: 'WITHHELD_CODE_LIST' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Origin/CountryCode', requirement: 'C', source: 'LineItem.countryOfOrigin', transform: 'ISO alpha-2', status: 'MAPPED' },
  { section: 'GovernmentAgencyGoodsItem', element: 'Packaging/QuantityQuantity', requirement: 'C', source: 'LineItem.packageCount/packageTypeCode', transform: 'package UOM', status: 'WITHHELD_CODE_LIST' },
  { section: 'Declaration', element: 'GovernmentProcedure/CurrentCode', requirement: 'C', source: 'first item CPC', transform: 'first three characters', status: 'DERIVED' },
] as const

export interface TfpReviewIssue {
  severity: 'BLOCKER' | 'WARNING'
  field: string
  message: string
}

export interface TfpPreflightResult {
  ready: boolean
  schemaVersion: string
  mappingVersion: string
  issues: TfpReviewIssue[]
}

export function preflightTfpDeclaration(declaration: BeaipDeclaration): TfpPreflightResult {
  const issues: TfpReviewIssue[] = []
  const blocker = (field: string, message: string) =>
    issues.push({ severity: 'BLOCKER', field, message })
  const warning = (field: string, message: string) =>
    issues.push({ severity: 'WARNING', field, message })

  if (!/^\d{4}DEC\d{10}$/.test(declaration.functionalReferenceId)) {
    blocker(
      'Declaration/FunctionalReferenceID',
      'Use the YYYYDEC########## declaration-reference convention',
    )
  }
  if (!['9', '5', '1'].includes(declaration.functionCode)) {
    blocker('Declaration/FunctionCode', 'Use 9 (original), 5 (amendment), or 1 (cancellation)')
  }
  if (!declaration.regimeCode.trim()) blocker('Declaration/TypeCode', 'Regime code is required')
  if (!declaration.submitterId.trim()) {
    blocker(
      'Declaration/Submitter/ID',
      'Set the brokerage Company Registration Number; TIN and licence number are not substitutes',
    )
  }
  if (declaration.customsOfficeCode !== TFP_DECLARATION_OFFICE_CODE) {
    blocker(
      'Declaration/DeclarationOffice/ID',
      `Use ${TFP_DECLARATION_OFFICE_CODE} until the office master sheet is available`,
    )
  }
  if (declaration.declarant.name !== TFP_DECLARANT_NAME) {
    blocker('Declaration/Declarant/Name', `Declarant must be ${TFP_DECLARANT_NAME}`)
  }
  if (!/^\d{4}00OREF\d{8}$/.test(declaration.brokerReference)) {
    blocker(
      'Declaration/GoodsShipment/UCR/TraderAssignedReferenceID',
      'Use the YYYY00OREF######## trader-reference convention',
    )
  }
  if (declaration.packageCount <= 0) {
    blocker('Declaration/TotalPackageQuantity', 'Package count must be positive')
  }
  if (!declaration.importer.name.trim()) {
    blocker('Declaration/GoodsShipment/Importer/Name', 'Importer name is required')
  }
  if (declaration.invoices.length === 0) {
    blocker('Declaration/GoodsShipment/Invoice', 'At least one commercial invoice is required')
  }
  if (declaration.lines.length === 0) {
    blocker(
      'Declaration/GoodsShipment/GovernmentAgencyGoodsItem',
      'At least one goods item is required',
    )
  }

  declaration.lines.forEach((line, index) => {
    const prefix = `GoodsItem[${index + 1}]`
    if (!/^\d{4}\.\d{2}\.\d{2}$/.test(line.hsCode)) {
      blocker(`${prefix}/Commodity/Classification/ID`, 'Use the internal 0000.00.00 HS format')
    }
    if (!/^[0-9A-Z-]{3,10}$/.test(line.cpcCode)) {
      blocker(`${prefix}/GovernmentProcedure/CurrentCode`, 'CPC format is invalid')
    }
    if (!line.description.trim()) blocker(`${prefix}/Commodity/Description`, 'Description is required')
    if (!line.invoiceNumber.trim()) {
      blocker(`${prefix}/Commodity/AdditionalDocument`, 'Invoice linkage is required')
    }
  })

  warning(
    'Declaration/TypeCode',
    'Regime code has not been verified against the withheld TTFB_SYS_REGIME worksheet',
  )
  warning(
    'Declaration/TotalPackageQuantity@unitCode',
    'Package UOM mapping is provisional until the official worksheet arrives',
  )
  return {
    ready: issues.every((issue) => issue.severity !== 'BLOCKER'),
    schemaVersion: TFP_SCHEMA_VERSION,
    mappingVersion: TFP_MAPPING_VERSION,
    issues,
  }
}
