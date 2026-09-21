/** Classify recognizable replies while leaving unknown business shapes for review. */
import { XMLParser, XMLValidator } from 'fast-xml-parser'

export type ParsedBeaipResponse =
  | { kind: 'SOAP_FAULT'; faultCode: string | null; faultReason: string | null; detail: unknown }
  | { kind: 'ACKNOWLEDGED'; beaipReference: string | null }
  | { kind: 'BUSINESS_REJECTED'; errors: unknown[] }
  | { kind: 'UNRECOGNIZED_RESPONSE' }

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false })

/**
 * Positive Customs acknowledgement codes. `MSGRECV` is the "message received" reply Customs
 * returns to a submitted declaration — the first half of the ack + status pair. Any other ack
 * code is left as UNRECOGNIZED so an unknown business shape is preserved for contract review.
 */
const POSITIVE_ACK_CODES = ['MSGRECV']

function firstString(node: unknown, keys: string[]): string | null {
  if (typeof node !== 'object' || node === null) return null
  for (const [key, value] of Object.entries(node)) {
    if (keys.includes(key) && (typeof value === 'string' || typeof value === 'number')) return String(value)
    const nested = firstString(value, keys)
    if (nested) return nested
  }
  return null
}

function parseXml(xml: string): Record<string, unknown> {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('DOCTYPE is not permitted in a BEAIP response')
  if (XMLValidator.validate(xml) !== true) throw new Error('BEAIP returned malformed XML')
  return parser.parse(xml) as Record<string, unknown>
}

/** The status operation must correlate with the MessageId Customs acknowledged. */
export function extractBeaipMessageId(xml: string): string | null {
  const parsed = parseXml(xml)
  const envelope = (parsed.Envelope ?? parsed) as Record<string, unknown>
  const body = (envelope.Body ?? envelope) as Record<string, unknown>
  // Customs carries the correlating id as <Acknowledgement><ID>. Read it from that node so the
  // generic 'ID' name cannot accidentally match an unrelated element in some other response.
  const acknowledgement = body.Acknowledgement as Record<string, unknown> | undefined
  if (acknowledgement) {
    const acknowledgedId = firstString(acknowledgement, ['MessageId', 'MessageID', 'MsgId', 'MsgID', 'ID'])
    if (acknowledgedId) return acknowledgedId
  }
  return firstString(body, ['MessageId', 'MessageID', 'MsgId', 'MsgID'])
}

export function parseBeaipResponse(xml: string): ParsedBeaipResponse {
  const parsed = parseXml(xml)
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

  // Customs replies to a received submission with <Acknowledgement><AckCode>MSGRECV</AckCode>.
  // This is the "message received" acknowledgement that unlocks the secondary status check.
  const acknowledgement = body.Acknowledgement as Record<string, unknown> | undefined
  if (acknowledgement) {
    const ackCode = firstString(acknowledgement, ['AckCode', 'Code'])?.toUpperCase()
    if (ackCode && POSITIVE_ACK_CODES.includes(ackCode)) {
      return {
        kind: 'ACKNOWLEDGED',
        beaipReference: firstString(acknowledgement, ['ID', 'ReferenceID', 'ReferenceNumber', 'EntryNumber', 'DeclarationNumber']),
      }
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
