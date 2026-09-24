import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '@/lib/env'

vi.mock('server-only', () => ({}))

import { postDeclarationSoap, postSubmissionStatusSoap } from '@/lib/beaip/transport/http-gateway'

const configuration = {
  BEAIP_TRANSPORT_MODE: 'live',
  BEAIP_ENVIRONMENT: 'qa',
  BEAIP_DECLARATION_SERVICE_URL: 'https://customs.example.test/declaration',
  BEAIP_DECLARATION_SOAP_ACTION: 'declaration-action',
  BEAIP_SUBMISSION_STATUS_SERVICE_URL: 'https://io-qa.besw.gov.bs/cxf/BEAIP/Miscellaneous/WSDL/SubmissionStatus/?wsdl',
  BEAIP_SUBMISSION_STATUS_SOAP_ACTION: 'status-action',
  BEAIP_TIMEOUT_MS: 15_000,
  BEAIP_MAX_RESPONSE_BYTES: 1_048_576,
  BEAIP_ALLOW_INSECURE_QA_HTTP: false,
} as Env

afterEach(() => vi.unstubAllGlobals())

describe('BEAIP status transport', () => {
  it('POSTs status to the supplied QA URL with its own SOAP action', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<status/>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await postSubmissionStatusSoap('<status-request/>', configuration)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0].href).toBe(configuration.BEAIP_SUBMISSION_STATUS_SERVICE_URL)
    expect(fetchMock.mock.calls[0]![1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: '<status-request/>',
      headers: expect.objectContaining({ SOAPAction: 'status-action' }),
    }))
    expect(response).toEqual({ httpStatus: 200, body: '<status/>' })
  })

  it('keeps declaration POSTs on the declaration URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<ack/>', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await postDeclarationSoap('<declaration/>', configuration)

    expect(fetchMock.mock.calls[0]![0].href).toBe(configuration.BEAIP_DECLARATION_SERVICE_URL)
    expect(fetchMock.mock.calls[0]![1].headers.SOAPAction).toBe('declaration-action')
  })

  it('refuses to send a production status check to the QA URL', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(postSubmissionStatusSoap('<status-request/>', { ...configuration, BEAIP_ENVIRONMENT: 'production' }))
      .rejects.toThrow('Configure a production submission status URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
