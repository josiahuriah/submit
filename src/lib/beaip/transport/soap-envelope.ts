/** Wrap reviewed declaration XML and keep credentials out of the persisted envelope. */
import { WCO_DECLARATION_NS } from '@/lib/beaip/wco-xml'

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
const WSSE_NS = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
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

export function buildDeclarationSoapEnvelope(input: {
  username: string
  password: string
  declarationXml: string
}): { envelope: string; redactedEnvelope: string } {
  const build = (password: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="${SOAP_NS}" xmlns:wsse="${WSSE_NS}">
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(input.username)}</wsse:Username>
        <wsse:Password Type="${PASSWORD_TEXT}">${escapeXml(password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
${declarationBody(input.declarationXml)}
  </soapenv:Body>
</soapenv:Envelope>`

  return {
    envelope: build(input.password),
    redactedEnvelope: build('[REDACTED]'),
  }
}
