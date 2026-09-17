import { describe, expect, it, vi } from 'vitest'
import { declarationArtifactsService } from '@/server/services/declaration-artifacts.service'

function dbWith(entry: unknown) {
  return {
    customsEntry: { findUnique: vi.fn().mockResolvedValue(entry) },
  } as never
}

describe('Customs response download', () => {
  it('returns the exact latest stored response with a traceable file name', async () => {
    const response = '<Envelope><Body><Status>SUCCESS</Status></Body></Envelope>'
    const db = dbWith({
      shipment: { shipmentNumber: 'SHP/2026 0001' },
      declarationType: 'C13',
      declarationGroupCode: '400',
      declarationSequence: 1,
      attempts: [{ attemptNumber: 2, responsePayload: response }],
    })

    await expect(declarationArtifactsService.getLatestResponse(db, 'entry-1')).resolves.toEqual({
      response,
      fileName: 'SHP-2026-0001-C13-400-1-attempt-2-response.xml',
    })
  })

  it('does not manufacture a response when no attempt has one', async () => {
    const db = dbWith({
      shipment: { shipmentNumber: 'SHP-1' },
      declarationType: 'C13',
      declarationGroupCode: '400',
      declarationSequence: 1,
      attempts: [],
    })

    await expect(declarationArtifactsService.getLatestResponse(db, 'entry-1'))
      .rejects.toThrow('Customs submission response not found')
  })
})
