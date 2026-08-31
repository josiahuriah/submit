/** Bound each explicit submission by time and response size; never retry it. */
import 'server-only'
import { env, type Env } from '@/lib/env'

export class BeaipTransportError extends Error {
  constructor(message: string, public readonly outcome: 'NETWORK_ERROR' | 'UNKNOWN') {
    super(message)
  }
}

async function readLimited(response: Response, maximum: number): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > maximum) throw new BeaipTransportError('BEAIP response exceeded the configured size limit', 'UNKNOWN')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximum) {
      await reader.cancel()
      throw new BeaipTransportError('BEAIP response exceeded the configured size limit', 'UNKNOWN')
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(joined)
}

export interface BeaipHttpResult { httpStatus: number; body: string }

export async function postDeclarationSoap(envelope: string, configuration: Env = env()): Promise<BeaipHttpResult> {
  if (configuration.BEAIP_TRANSPORT_MODE !== 'live') {
    throw new BeaipTransportError('BEAIP transport is disabled', 'NETWORK_ERROR')
  }
  const target = new URL(configuration.BEAIP_DECLARATION_SERVICE_URL)
  if (target.protocol === 'http:' && !(configuration.BEAIP_ENVIRONMENT === 'qa' && configuration.BEAIP_ALLOW_INSECURE_QA_HTTP)) {
    throw new BeaipTransportError('Plain HTTP is not allowed for this BEAIP environment', 'NETWORK_ERROR')
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), configuration.BEAIP_TIMEOUT_MS)
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: configuration.BEAIP_DECLARATION_SOAP_ACTION,
      },
      body: envelope,
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    return { httpStatus: response.status, body: await readLimited(response, configuration.BEAIP_MAX_RESPONSE_BYTES) }
  } catch (error) {
    if (error instanceof BeaipTransportError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new BeaipTransportError('Submission timed out after transmission; receipt is unknown', 'UNKNOWN')
    }
    throw new BeaipTransportError('Could not communicate with the BEAIP service', 'NETWORK_ERROR')
  } finally {
    clearTimeout(timeout)
  }
}
