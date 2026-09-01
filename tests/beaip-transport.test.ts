import { describe, expect, it } from 'vitest'
import { buildDeclarationSoapEnvelope } from '@/lib/beaip/transport/soap-envelope'
import { parseBeaipResponse } from '@/lib/beaip/transport/response-parser'
import { normalizeHsCode } from '@/lib/customs/normalization'

const declaration = `<?xml version="1.0" encoding="UTF-8"?>
<Declaration xmlns="http://globaletrade.services/Declaration"><FunctionCode>9</FunctionCode></Declaration>`

describe('BEAIP SOAP transport contracts', () => {
  it('places the declaration directly in the SOAP body and redacts the password', () => {
    const result = buildDeclarationSoapEnvelope({
      username: 'broker&qa', password: 'secret<value>', declarationXml: declaration,
    })
    expect(result.envelope).toContain('<soapenv:Body>\n<Declaration')
    expect(result.envelope).not.toContain('&lt;Declaration')
    expect(result.envelope).toContain('broker&amp;qa')
    expect(result.envelope).toContain('secret&lt;value&gt;')
    // The PasswordText URI is from the government-supplied soap_header.txt.
    expect(result.envelope).toContain('Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText"')
    expect(result.envelope).toMatch(/<wsse:UsernameToken wsu:Id="UsernameToken-[0-9A-F]{32}"/)
    expect(result.envelope).toContain('xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"')
    expect(result.redactedEnvelope).not.toContain('secret')
    expect(result.redactedEnvelope).toContain('[REDACTED]')
    expect(result.redactedEnvelope.match(/UsernameToken-[0-9A-F]{32}/)?.[0])
      .toBe(result.envelope.match(/UsernameToken-[0-9A-F]{32}/)?.[0])
    expect(result.envelope.match(/<\?xml/g)).toHaveLength(1)
  })

  it('parses SOAP faults without depending on the namespace prefix', () => {
    const parsed = parseBeaipResponse(`
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
        <s:Body><s:Fault><faultcode>s:Server</faultcode><faultstring>Invalid declaration</faultstring></s:Fault></s:Body>
      </s:Envelope>`)
    expect(parsed).toEqual(expect.objectContaining({ kind: 'SOAP_FAULT', faultReason: 'Invalid declaration' }))
  })

  it('preserves unrecognized valid responses as an explicit outcome', () => {
    expect(parseBeaipResponse('<Envelope><Body><CustomReply>received</CustomReply></Body></Envelope>'))
      .toEqual({ kind: 'UNRECOGNIZED_RESPONSE' })
  })

  it('preserves leading zeroes in government reference numbers', () => {
    expect(parseBeaipResponse('<Envelope><Body><Status>SUCCESS</Status><ReferenceID>001234</ReferenceID></Body></Envelope>'))
      .toEqual({ kind: 'ACKNOWLEDGED', beaipReference: '001234' })
  })
})

describe('HS normalization', () => {
  it.each([
    ['9403.50.90', '94035090'], ['9403-50-90', '94035090'],
    ['9403 50 90', '94035090'], ['01/02/03/04', '01020304'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeHsCode(input)).toBe(expected)
  })
})
