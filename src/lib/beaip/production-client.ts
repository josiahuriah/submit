/**
 * Production BEAIP SOAP client (Bahamas Customs Single Window / CrimsonLogic).
 *
 * STATUS: implementation-complete but env-gated. It activates only when
 * BEAIP_MODE=production and credentials are present; until then the factory
 * (index.ts) serves the mock client. When real WSDL documentation arrives,
 * the only expected changes are the SOAP action names and the exact element
 * names inside buildEnvelope() / parseResponse() — the transport, auth,
 * error handling and audit-payload plumbing are final.
 *
 * Design notes:
 *   - fast-xml-parser (pure JS) for building/parsing — no native SOAP lib,
 *     no build-step problems on Vercel.
 *   - WS-Security UsernameToken header (the scheme CrimsonLogic gateways
 *     conventionally use); swap for the documented scheme if it differs.
 *   - Every request/response is returned verbatim to the caller for
 *     persistence on CustomsEntry.requestPayload/responsePayload.
 */
import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { env } from '@/lib/env'
import type { BeaipClient, BeaipDeclaration, BeaipSubmissionResult } from './types'

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/'
const WSSE_NS =
  'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd'
// Placeholder namespace — replace with the value from the official WSDL.
const BEAIP_NS = 'urn:bs:gov:customs:beaip:declaration:v1'

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export class ProductionBeaipClient implements BeaipClient {
  readonly mode = 'production' as const

  private get config() {
    const { BEAIP_ENDPOINT, BEAIP_USERNAME, BEAIP_PASSWORD, BEAIP_BROKER_CODE } = env()
    if (!BEAIP_ENDPOINT || !BEAIP_USERNAME || !BEAIP_PASSWORD) {
      throw new Error(
        'BEAIP production mode requires BEAIP_ENDPOINT, BEAIP_USERNAME and BEAIP_PASSWORD',
      )
    }
    return {
      endpoint: BEAIP_ENDPOINT,
      username: BEAIP_USERNAME,
      password: BEAIP_PASSWORD,
      brokerCode: BEAIP_BROKER_CODE,
    }
  }

  async submitDeclaration(declaration: BeaipDeclaration): Promise<BeaipSubmissionResult> {
    const { endpoint } = this.config
    const envelopeXml = this.buildEnvelope('SubmitDeclaration', declaration)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        // SOAPAction value to be confirmed against the WSDL.
        SOAPAction: `${BEAIP_NS}/SubmitDeclaration`,
      },
      body: envelopeXml,
      signal: AbortSignal.timeout(60_000),
    })

    const rawXml = await response.text()
    const parsed = this.parseResponse(rawXml)

    if (!response.ok || parsed.fault) {
      return {
        success: false,
        beaipReference: null,
        entryNumber: null,
        status: 'REJECTED',
        message: parsed.fault ?? `BEAIP returned HTTP ${response.status}`,
        requestPayload: envelopeXml,
        responsePayload: rawXml,
      }
    }

    return {
      success: true,
      beaipReference: parsed.reference,
      entryNumber: parsed.entryNumber,
      status: 'ACCEPTED',
      message: parsed.message ?? 'Declaration accepted',
      requestPayload: envelopeXml,
      responsePayload: rawXml,
    }
  }

  async getDeclarationStatus(beaipReference: string) {
    const { endpoint } = this.config
    const envelopeXml = this.buildEnvelope('GetDeclarationStatus', { reference: beaipReference })

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `${BEAIP_NS}/GetDeclarationStatus`,
      },
      body: envelopeXml,
      signal: AbortSignal.timeout(30_000),
    })

    const rawXml = await response.text()
    const parsed = this.parseResponse(rawXml)
    return {
      status: parsed.status ?? 'UNKNOWN',
      message: parsed.message ?? parsed.fault ?? '',
      responsePayload: rawXml,
    }
  }

  // --- SOAP plumbing ----------------------------------------------------------

  private buildEnvelope(operation: string, body: unknown): string {
    const { username, password, brokerCode } = this.config
    const envelope = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      'soap:Envelope': {
        '@_xmlns:soap': SOAP_NS,
        '@_xmlns:wsse': WSSE_NS,
        '@_xmlns:bea': BEAIP_NS,
        'soap:Header': {
          'wsse:Security': {
            'wsse:UsernameToken': {
              'wsse:Username': username,
              'wsse:Password': password,
            },
          },
        },
        'soap:Body': {
          [`bea:${operation}`]: {
            'bea:BrokerCode': brokerCode,
            'bea:Payload': body,
          },
        },
      },
    }
    return builder.build(envelope)
  }

  private parseResponse(xml: string): {
    fault: string | null
    reference: string | null
    entryNumber: string | null
    status: string | null
    message: string | null
  } {
    try {
      const doc = parser.parse(xml) as Record<string, unknown>
      const flat = JSON.stringify(doc)

      // SOAP fault detection (namespace-agnostic).
      const faultMatch = /"faultstring"\s*:\s*"([^"]+)"/i.exec(flat)
      if (faultMatch) {
        return { fault: faultMatch[1]!, reference: null, entryNumber: null, status: null, message: null }
      }

      const pick = (key: string): string | null => {
        const m = new RegExp(`"(?:[\\w]+:)?${key}"\\s*:\\s*"([^"]+)"`, 'i').exec(flat)
        return m ? m[1]! : null
      }

      return {
        fault: null,
        reference: pick('Reference') ?? pick('ReferenceNumber'),
        entryNumber: pick('EntryNumber'),
        status: pick('Status'),
        message: pick('Message'),
      }
    } catch {
      return { fault: 'Unparseable BEAIP response', reference: null, entryNumber: null, status: null, message: null }
    }
  }
}
