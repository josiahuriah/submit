/** Classify recognizable replies while leaving unknown business shapes for review. */
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export type ParsedBeaipResponse =
  | { kind: 'SOAP_FAULT'; faultCode: string | null; faultReason: string | null; detail: unknown }
  | { kind: 'ACKNOWLEDGED'; beaipReference: string | null }
  | { kind: 'BUSINESS_REJECTED'; errors: unknown[] }
  | { kind: 'UNRECOGNIZED_RESPONSE' }

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })

function firstString(node: unknown, keys: string[]): string | null {
  if (typeof node !== 'object' || node === null) return null
  for (const [key, value] of Object.entries(node)) {
    if (keys.includes(key) && (typeof value === 'string' || typeof value === 'number')) return String(value)
    const nested = firstString(value, keys)
    if (nested) return nested
  }
  return null
}

export function parseBeaipResponse(xml: string): ParsedBeaipResponse {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('DOCTYPE is not permitted in a BEAIP response')
  if (XMLValidator.validate(xml) !== true) throw new Error('BEAIP returned malformed XML')
  const parsed = parser.parse(xml) as Record<string, unknown>
  const envelope = (parsed.Envelope ?? parsed) as Record<string, unknown>
  const body = (envelope.Body ?? envelope) as Record<string, unknown>
  const fault = body.Fault as Record<string, unknown> | undefined
  if (fault) {
    return {
      kind: 'SOAP_FAULT',
      faultCode: firstString(fault, ['faultcode', 'Code', 'Value']),
      faultReason: firstString(fault, ['faultstring', 'Reason', 'Text']),
      detail: fault.detail ?? fault.Detail ?? null,
    }
  }

  const status = firstString(body, ['Status', 'StatusCode', 'ResultCode', 'Outcome'])?.toUpperCase()
  if (status && ['REJECTED', 'ERROR', 'FAILED', 'INVALID'].includes(status)) {
    return { kind: 'BUSINESS_REJECTED', errors: [body] }
  }
  if (status && ['ACCEPTED', 'ACKNOWLEDGED', 'SUCCESS', 'VALID'].includes(status)) {
    return {
      kind: 'ACKNOWLEDGED',
      beaipReference: firstString(body, ['ReferenceID', 'ReferenceNumber', 'EntryNumber', 'DeclarationNumber']),
    }
  }
  return { kind: 'UNRECOGNIZED_RESPONSE' }
}
