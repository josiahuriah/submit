/**
 * Internal declaration contract carrying everything the TFP Single Window's
 * TFB_WCO_DEC v1.4.4 message needs (see docs/tfp-single-window-gap-analysis.md).
 * Serialization to the WCO XML document lives in wco-xml.ts.
 */

export interface BeaipPartyAddress {
  cityName: string | null
  countryCode: string | null
  /** Free-text street line (Client/Supplier addresses are unstructured today). */
  line: string | null
  postcode: string | null
}

export interface BeaipParty {
  name: string
  /** TIN / NIB / company registration number, as applicable to the party. */
  id: string | null
  address: BeaipPartyAddress | null
}

export interface BeaipInvoice {
  invoiceNumber: string
  /** ISO datetime string, or null when the date is unknown. */
  invoiceDate: string | null
  /** Compatibility field validated as BSD at the submission boundary. */
  currency: string
  /** Compatibility field fixed at 1; Submit does not perform FX conversion. */
  exchangeRate: string
  incotermCode: string | null
  incotermLocation: string | null
  subTotal: string
  supplier: BeaipParty
  /** Engine-apportioned shipment costs summed over this invoice's lines. */
  freightApportioned: string
  insuranceApportioned: string
  otherApportioned: string
}

export interface BeaipTransport {
  vesselName: string | null
  /** Our TransportMode enum value (SEA/AIR/LAND); wire codes map in wco-xml. */
  transportMode: string | null
  /** ISO datetime of arrival (voyage.arrivalDate). */
  arrivalDate: string | null
  containerNumber: string | null
  containerSealNumber: string | null
  containerFullnessCode: string | null
  manifestNumber: string | null
  /** UN/LOCODEs from the voyage's journey. */
  unloadingPortCode: string | null
  entryPortCode: string | null
  exitPortCode: string | null
  /** ISO alpha-2; origin port country, falling back to supplier country. */
  exportCountryCode: string | null
  transportNationalityCode: string | null
  goodsLocationCode: string | null
  warehouseCode: string | null
}

export interface BeaipDeclarationLine {
  lineNumber: number
  /** Links the line to its parent commercial invoice on the wire. */
  invoiceNumber: string
  hsCode: string
  /** Customs Procedure Code (item-level GovernmentProcedure/CurrentCode). */
  cpcCode: string
  description: string
  commercialDescription: string | null
  countryOfOrigin: string | null
  quantity: string
  unit: string
  weightLb: string | null
  netWeightLb: string | null
  packageCount: number | null
  packageTypeCode: string | null
  /** Line FOB entered by the user in BSD (Commodity/ValueAmount). */
  totalValue: string
  /** Compatibility field validated as BSD at the submission boundary. */
  currency: string
  /** Apportioned shipment costs (item-level CustomsValuation), BSD. */
  freightApportioned: string
  insuranceApportioned: string
  otherApportioned: string
  cifValue: string
  dutyAmount: string
  vatAmount: string
  levyAmount: string
  exciseAmount: string
  dutyAssessmentQuantity: string | null
  dutyAssessmentUnit: string | null
  exciseAssessmentQuantity: string | null
  exciseAssessmentUnit: string | null
}

export interface BeaipDeclaration {
  isSplitDeclaration: boolean
  declarationGroupCode: string
  declarationSequence: number
  declarationType: string // C13, C14, C17, C18 — domain label, NOT a wire field
  /**
   * Wire TypeCode (Regime, code table TTFB_SYS_REGIME). PLACEHOLDER until the
   * Regime worksheet arrives; the spec's sample uses "4".
   */
  regimeCode: string
  /** EDIFACT 1225: 9 original, 5 amendment, 1 cancellation. */
  functionCode: '9' | '5' | '1'
  /** ISO date used for rate selection and artifact provenance. */
  declarationDate: string
  /** Click2Clear-shaped declaration reference, e.g. 2026DEC0001234567. */
  functionalReferenceId: string
  /** Trader reference, e.g. 201800OREF02331212. */
  brokerReference: string
  customsOfficeCode: string
  /** Submitter company registration number (mandatory on the wire). */
  submitterId: string
  /** The brokerage filing the declaration. */
  declarant: BeaipParty
  importer: BeaipParty
  consignee: BeaipParty
  blNumber: string | null
  packageCount: number
  /** Our PackageType enum value; wire UOM codes map in wco-xml. */
  packageUom: string
  grossWeightLb: string | null
  transport: BeaipTransport
  invoices: BeaipInvoice[]
  totalCifValue: string
  totalDuty: string
  totalVat: string
  totalLevy: string
  totalExcise: string
  processingFee: string
  totalPayable: string
  lines: BeaipDeclarationLine[]
}
