/** Submission safety checks use a fake gateway; no Customs endpoint is called. */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantClient } from '@/lib/db/tenant-client'

const mocks = vi.hoisted(() => ({ post: vi.fn(), audit: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/env', () => ({ env: () => ({ BEAIP_TRANSPORT_MODE: 'live', BEAIP_USERNAME: 'test-user', BEAIP_PASSWORD: 'test-only' }) }))
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.audit }))
vi.mock('@/lib/beaip/transport/http-gateway', () => ({
  postDeclarationSoap: mocks.post,
  BeaipTransportError: class extends Error {},
}))
import { customsSubmissionService } from '@/server/services/customs-submission.service'

const xml = '<Declaration xmlns="http://globaletrade.services/Declaration"><FunctionCode>9</FunctionCode></Declaration>'
const rawResponse = '<Envelope><Body><Status>SUCCESS</Status><ReferenceID>001234</ReferenceID></Body></Envelope>'
function fixture() {
  const entry = {
    id: 'entry-1', shipmentId: 'shipment-1', submissionBatchId: 'batch-1',
    requestPayload: xml, declarationHash: createHash('sha256').update(xml).digest('hex'),
    generatedAt: new Date('2026-08-31T12:00:00Z'),
    shipment: { status: 'DRAFT', calculatedAt: new Date('2026-08-31T11:59:00Z') as Date | null, updatedAt: new Date('2026-08-31T11:59:00Z') },
    attempts: [] as { attemptNumber: number; outcome: string }[],
  }
  const db = {
    customsEntry: { findUnique: vi.fn().mockResolvedValue(entry), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    customsSubmissionAttempt: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'attempt-1' }), update: vi.fn() },
    shipment: { update: vi.fn() },
  }
  return { entry, db, submit: () => customsSubmissionService.submit(db as unknown as TenantClient, { userId: 'broker-1' }, entry.id, { confirmResubmission: false }) }
}

beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue({ httpStatus: 200, body: rawResponse }) })

describe('Customs submission safety', () => {
  it('does not send an artifact after edits invalidate its calculation', async () => {
    const f = fixture()
    f.entry.shipment.calculatedAt = null
    await expect(f.submit()).rejects.toThrow(/recalculate/)
    expect(mocks.post).not.toHaveBeenCalled()
    expect(f.db.customsSubmissionAttempt.create).not.toHaveBeenCalled()
  })

  it('requires regenerated XML after a newer calculation', async () => {
    const f = fixture()
    f.entry.shipment.calculatedAt = new Date('2026-08-31T12:01:00Z')
    await expect(f.submit()).rejects.toThrow(/generate new review XML/)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('does not send another request while this entry has a pending attempt', async () => {
    const f = fixture()
    f.entry.attempts = [{ attemptNumber: 1, outcome: 'PENDING' }]
    await expect(f.submit()).rejects.toThrow(/still pending/)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('requires explicit confirmation before repeating a previous attempt', async () => {
    const f = fixture()
    f.db.customsSubmissionAttempt.count.mockResolvedValue(1)
    await expect(f.submit()).rejects.toThrow(/Explicit confirmation/)
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('records the raw response and preserves its government reference', async () => {
    const f = fixture()
    const result = await f.submit()
    expect(mocks.post).toHaveBeenCalledOnce()
    expect(result).toEqual(expect.objectContaining({ outcome: 'ACKNOWLEDGED', responsePayload: rawResponse, beaipReference: '001234' }))
    expect(f.db.customsSubmissionAttempt.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ responsePayload: rawResponse, beaipReference: '001234' }) }))
    expect(f.db.customsSubmissionAttempt.create.mock.calls[0]![0].data.redactedSoapEnvelope).not.toContain('test-only')
  })
})
