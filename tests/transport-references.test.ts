import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessRuleError } from '@/lib/errors'

const mocks = vi.hoisted(() => ({
  carrierFindUnique: vi.fn(),
  vesselCreate: vi.fn(),
  portFindMany: vi.fn(),
  writeAudit: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  basePrisma: {
    carrier: { findUnique: mocks.carrierFindUnique },
    vessel: { create: mocks.vesselCreate },
    port: { findMany: mocks.portFindMany },
  },
}))

vi.mock('@/lib/audit', () => ({ writeAudit: mocks.writeAudit }))

import { transportReferencesService } from '@/server/services/transport-references.service'

const db = {} as never
const audit = { userId: 'user-1' }

describe('transport reference service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects a vessel or aircraft whose mode does not match its carrier', async () => {
    mocks.carrierFindUnique.mockResolvedValue({
      id: 'carrier-1',
      name: 'Sea Carrier',
      mode: 'SEA',
      isActive: true,
    })

    await expect(transportReferencesService.createVessel(db, audit, {
      carrierId: 'carrier-1',
      name: 'Cargo Aircraft',
      mode: 'AIR',
    })).rejects.toBeInstanceOf(BusinessRuleError)
    expect(mocks.vesselCreate).not.toHaveBeenCalled()
  })

  it('never stores an IMO number on an aircraft', async () => {
    mocks.carrierFindUnique.mockResolvedValue({
      id: 'carrier-1',
      name: 'Air Carrier',
      mode: 'AIR',
      isActive: true,
    })
    mocks.vesselCreate.mockResolvedValue({
      id: 'aircraft-1',
      name: 'Cargo Aircraft',
      mode: 'AIR',
      carrier: { name: 'Air Carrier' },
    })

    await transportReferencesService.createVessel(db, audit, {
      carrierId: 'carrier-1',
      name: 'Cargo Aircraft',
      mode: 'AIR',
      imoNumber: 'NOT-AN-IMO',
    })

    expect(mocks.vesselCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imoNumber: undefined }),
    }))
  })

  it('rejects a route that starts and ends at the same port before querying', async () => {
    await expect(transportReferencesService.createJourney(db, audit, {
      originPortId: 'port-1',
      destinationPortId: 'port-1',
    })).rejects.toBeInstanceOf(BusinessRuleError)
    expect(mocks.portFindMany).not.toHaveBeenCalled()
  })
})
