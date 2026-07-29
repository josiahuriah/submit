/**
 * Mock BEAIP client — fully functional test mode.
 *
 * Behaves like the real Single Window would: validates the declaration,
 * assigns a reference in BEAIP's format, and returns a structured response.
 * Lets the entire submit → track workflow be exercised end-to-end before
 * production credentials exist.
 *
 * Deterministic failure hook: a brokerReference containing "REJECT" comes
 * back rejected, so error paths are testable on demand.
 */
import type { BeaipClient, BeaipDeclaration, BeaipSubmissionResult } from './types'

function mockReference(): string {
  const year = new Date().getFullYear()
  const serial = Math.floor(100000 + Math.random() * 900000)
  return `BS-${year}-E${serial}`
}

function validate(declaration: BeaipDeclaration): string | null {
  if (declaration.lines.length === 0) return 'Declaration has no line items'
  if (!declaration.customsOfficeCode) return 'Missing customs office code'
  const badLine = declaration.lines.find((l) => !/^\d{4}\.\d{2}(\.\d{2})?$/.test(l.hsCode))
  if (badLine) return `Line ${badLine.lineNumber}: HS code "${badLine.hsCode}" is not in a valid format`
  return null
}

export class MockBeaipClient implements BeaipClient {
  readonly mode = 'mock' as const

  async submitDeclaration(declaration: BeaipDeclaration): Promise<BeaipSubmissionResult> {
    // Simulate network + processing latency.
    await new Promise((r) => setTimeout(r, 300))

    const validationError = validate(declaration)
    const forcedRejection = declaration.brokerReference.toUpperCase().includes('REJECT')

    if (validationError || forcedRejection) {
      const message = validationError ?? 'Declaration rejected by mock validator (forced)'
      return {
        success: false,
        beaipReference: null,
        entryNumber: null,
        status: 'REJECTED',
        message,
        requestPayload: declaration,
        responsePayload: { code: 'ERR-400', message },
      }
    }

    const reference = mockReference()
    const entryNumber = `C-${Math.floor(10000 + Math.random() * 90000)}`
    return {
      success: true,
      beaipReference: reference,
      entryNumber,
      status: 'ACCEPTED',
      message: `Declaration accepted (MOCK). Reference ${reference}.`,
      requestPayload: declaration,
      responsePayload: {
        code: 'OK-200',
        reference,
        entryNumber,
        assessedTotal: declaration.totalPayable,
        receivedAt: new Date().toISOString(),
      },
    }
  }

  async getDeclarationStatus(beaipReference: string) {
    await new Promise((r) => setTimeout(r, 150))
    return {
      status: 'UNDER_ASSESSMENT',
      message: `Mock status for ${beaipReference}`,
      responsePayload: { reference: beaipReference, status: 'UNDER_ASSESSMENT' },
    }
  }
}
