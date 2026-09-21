/** Build the two Customs SOAP requests while keeping credentials out of persisted envelopes. */
import { randomBytes } from 'node:crypto'
import { WCO_DECLARATION_NS } from '@/lib/beaip/wco-xml'

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
const WSU_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd'
const PASSWORD_TEXT = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function declarationBody(xml: string): string {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('DOCTYPE is not permitted')
  const body = xml.replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trim()
  if (!body.startsWith('<Declaration') || !body.includes(`xmlns="${WCO_DECLARATION_NS}"`)) {
    throw new Error('SOAP body must contain a WCO Declaration document')
  }
  return body
}

function buildSoapEnvelope(input: {
  username: string
  password: string
  body: string
}): { envelope: string; redactedEnvelope: string } {
  // Match the government-supplied QA header with a unique, XML-valid token ID.
  // Build it once so the persisted redacted envelope describes the exact request.
  const usernameTokenId = `UsernameToken-${randomBytes(16).toString('hex').toUpperCase()}`
  const build = (password: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:wsse="${WSSE_NS}">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="0">
      <wsse:UsernameToken wsu:Id="${usernameTokenId}" xmlns:wsu="${WSU_NS}">
        <wsse:Username>${escapeXml(input.username)}</wsse:Username>
        <wsse:Password Type="${PASSWORD_TEXT}">${escapeXml(password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
${input.body}
  </soapenv:Body>
</soapenv:Envelope>`

  return {
    envelope: build(input.password),
    redactedEnvelope: build('[REDACTED]'),
  }
}

function messageDate(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`
}

export function buildDeclarationSoapEnvelope(input: {
  username: string
  password: string
  declarationXml: string
}): { envelope: string; redactedEnvelope: string } {
  return buildSoapEnvelope({
    username: input.username,
    password: input.password,
    body: declarationBody(input.declarationXml),
  })
}

export function buildSubmissionStatusSoapEnvelope(input: {
  username: string
  password: string
  requestMessageId: string
  originalMessageId: string
  sender: string
  receiver: string
  requestedAt: Date
  timeZone: string
}): { envelope: string; redactedEnvelope: string } {
  const body = `    <SubmissionStatusRequest SchemaVersion="0.1" xmlns="http://beaip.crimsonlogic.com/SUB_ST_REQ">
      <MessageHeader schemaVersion="0.1" xmlns="http://beaip.crimsonlogic.com/MessageHeader">
        <MessageId>${escapeXml(input.requestMessageId)}</MessageId>
        <MessageDate>${messageDate(input.requestedAt, input.timeZone)}</MessageDate>
        <messageFunction>1</messageFunction>
        <MessageType>SUB_STS_MSG</MessageType>
        <Sender>${escapeXml(input.sender)}</Sender>
        <Receiver>${escapeXml(input.receiver)}</Receiver>
      </MessageHeader>
      <DocumentDetails>
        <OriginalMsgId>${escapeXml(input.originalMessageId)}</OriginalMsgId>
      </DocumentDetails>
    </SubmissionStatusRequest>`
  return buildSoapEnvelope({ username: input.username, password: input.password, body })
}
