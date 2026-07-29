/**
 * BEAIP integration contracts.
 * One interface, two implementations (mock + production) selected by env —
 * the rest of the codebase never knows which one it's talking to.
 */

export interface BeaipDeclarationLine {
  lineNumber: number
  hsCode: string
  description: string
  countryOfOrigin: string | null
  quantity: string
  unit: string
  cifValue: string
  dutyAmount: string
  vatAmount: string
  levyAmount: string
  exciseAmount: string
}

export interface BeaipDeclaration {
  declarationType: string // C13, C14, C17, C18
  brokerReference: string // our shipment number
  customsOfficeCode: string // NAS, FPO, ...
  importerName: string
  importerTin: string | null
  blNumber: string | null
  packageCount: number
  grossWeightKg: string | null
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
