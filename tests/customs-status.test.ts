/** Status checks use a fake gateway; no Customs endpoint is called. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantClient } from '@/lib/db/tenant-client'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  audit: vi.fn(),
  configuration: {
    BEAIP_TRANSPORT_MODE: 'live',
    BEAIP_USERNAME: 'test-user',
    BEAIP_PASSWORD: 'test-only',
    BEAIP_SENDER: 'SHIPAGENTS',
    BEAIP_RECEIVER: 'BESWS',
    BEAIP_TIMEZONE: 'America/Nassau',
    NODE_ENV: 'production',
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({ env: () => mocks.configuration }))
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.audit }))
vi.mock('@/lib/beaip/transport/http-gateway', () => ({
  postSubmissionStatusSoap: mocks.post,
  BeaipTransportError: class extends Error {},
}))
import { customsStatusService } from '@/server/services/customs-status.service'

const acknowledgement = `
<Envelope><Body><Acknowledgement><MessageHeader>
  <MessageId>SUBMITDEC000000001</MessageId>
</MessageHeader><Status>SUCCESS</Status></Acknowledgement></Body></Envelope>`
const secondaryResponse = '<Envelope><Body><SubmissionStatus><Status>PROCESSING</Status></SubmissionStatus></Body></Envelope>'

function fixture(responsePayload: string | null = acknowledgement) {
  const attempt = {
    id: 'attempt-1', attemptNumber: 1, responsePayload,
    statusChecks: [] as { checkNumber: number; outcome: string }[],
  }
  const entry = { id: 'entry-1', attempts: responsePayload ? [attempt] : [] }
  const statusCreate = vi.fn().mockResolvedValue({ id: 'status-1' })
  const statusUpdate = vi.fn()
  const entryUpdate = vi.fn()
  const tx = {
    customsSubmissionStatusCheck: { update: statusUpdate },
    customsEntry: { update: entryUpdate },
  }
  const db = {
    customsEntry: { findUnique: vi.fn().mockResolvedValue(entry) },
    customsSubmissionStatusCheck: { create: statusCreate, update: statusUpdate },
    $tenantTransaction: vi.fn(async (fn: (client: typeof tx) => Promise<void>) => fn(tx)),
  }
  return {
    attempt,
    db,
    statusCreate,
    statusUpdate,
    entryUpdate,
    check: () => customsStatusService.check(db as unknown as TenantClient, { userId: 'broker-1' }, entry.id),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configuration.BEAIP_TRANSPORT_MODE = 'live'
  mocks.configuration.NODE_ENV = 'production'
  mocks.post.mockResolvedValue({ httpStatus: 200, body: secondaryResponse })
})

describe('Customs submission status checks', () => {
  it('posts a persisted request correlated to the acknowledgement MessageId', async () => {
    const f = fixture()

    const result = await f.check()

    expect(f.statusCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ originalMessageId: 'SUBMITDEC000000001' }),
    }))
    const sentEnvelope = mocks.post.mock.calls[0]![0] as string
    expect(sentEnvelope).toContain('<OriginalMsgId>SUBMITDEC000000001</OriginalMsgId>')
    expect(f.statusCreate.mock.calls[0]![0].data.redactedSoapEnvelope).not.toContain('test-only')
    expect(f.statusUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ responsePayload: secondaryResponse, httpStatus: 200 }),
    }))
    expect(f.entryUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { responsePayload: secondaryResponse } }))
    expect(result).toEqual(expect.objectContaining({
      originalMessageId: 'SUBMITDEC000000001',
      responsePayload: secondaryResponse,
      responseDownloadUrl: '/api/customs-entries/entry-1/status-response',
    }))
  })

  it('refuses to guess when the acknowledgement has no MessageId', async () => {
    const f = fixture('<Envelope><Body><Status>SUCCESS</Status></Body></Envelope>')

    await expect(f.check()).rejects.toThrow(/stored Customs acknowledgement is required/)
    expect(mocks.post).not.toHaveBeenCalled()
    expect(f.statusCreate).not.toHaveBeenCalled()
  })

  it('previews the exact status request in development without sending or writing', async () => {
    mocks.configuration.BEAIP_TRANSPORT_MODE = 'disabled'
    mocks.configuration.NODE_ENV = 'development'
    const f = fixture()

    const result = await f.check()

    expect(result).toEqual(expect.objectContaining({
      outcome: 'PREVIEW',
      originalMessageId: 'SUBMITDEC000000001',
      soapEnvelope: expect.stringContaining('<OriginalMsgId>SUBMITDEC000000001</OriginalMsgId>'),
    }))
    expect(mocks.post).not.toHaveBeenCalled()
    expect(f.statusCreate).not.toHaveBeenCalled()
  })

  it('returns the exact latest stored secondary response for download', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      checkNumber: 2,
      responsePayload: secondaryResponse,
      submissionAttempt: {
        attemptNumber: 1,
        customsEntry: {
          declarationType: 'C13',
          declarationGroupCode: '400',
          declarationSequence: 1,
          shipment: { shipmentNumber: 'SHP/2026 0001' },
        },
      },
    })

    await expect(customsStatusService.getLatestResponse({
      customsSubmissionStatusCheck: { findFirst },
    } as unknown as TenantClient, 'entry-1')).resolves.toEqual({
      response: secondaryResponse,
      fileName: 'SHP-2026-0001-C13-400-1-attempt-1-status-2-response.xml',
    })
  })
})
