/**
 * BEAIP integration contracts.
 * One interface, two implementations (mock + production) selected by env —
 * the rest of the codebase never knows which one it's talking to.
 *
 * The declaration shape carries everything the TFP Single Window's
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
  currency: string
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
  manifestNumber: string | null
  /** UN/LOCODEs from the voyage's journey. */
  unloadingPortCode: string | null
  entryPortCode: string | null
  exitPortCode: string | null
  /** ISO alpha-2; origin port country, falling back to supplier country. */
  exportCountryCode: string | null
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
  weightKg: string | null
  /** Line FOB in the invoice currency (Commodity/ValueAmount). */
  totalValue: string
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
}

export interface BeaipDeclaration {
  declarationType: string // C13, C14, C17, C18 — domain label, NOT a wire field
  /**
   * Wire TypeCode (Regime, code table TTFB_SYS_REGIME). PLACEHOLDER until the
   * Regime worksheet arrives; the spec's sample uses "4".
   */
  regimeCode: string
  /** FunctionalReferenceID — sender's unique reference (our shipment number). */
  functionalReferenceId: string
  brokerReference: string // our shipment number
  customsOfficeCode: string // NAS, FPO, ...
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
  grossWeightKg: string | null
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

export interface BeaipSubmissionResult {
  success: boolean
  /** Reference number assigned by BEAIP (e.g. entry registration number). */
  beaipReference: string | null
  entryNumber: string | null
  status: 'ACCEPTED' | 'REJECTED'
  message: string
  /** The exact payload we sent — persisted for the audit trail. */
  requestPayload: unknown
  /** The exact response we received. */
  responsePayload: unknown
}

export interface BeaipClient {
  readonly mode: 'mock' | 'production'
  submitDeclaration(declaration: BeaipDeclaration): Promise<BeaipSubmissionResult>
  /** Query the status of a previously submitted declaration. */
  getDeclarationStatus(beaipReference: string): Promise<{
    status: string
    message: string
    responsePayload: unknown
  }>
}
