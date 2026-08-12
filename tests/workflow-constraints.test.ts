import { describe, expect, it } from 'vitest'
import {
  declarationArtifactSchema,
  journeyCreateSchema,
  shipmentCreateSchema,
  vesselCreateSchema,
} from '@/lib/validation/schemas'
import { ORIGINAL_DECLARATION_FUNCTION_CODE, TFP_COMPANY_REGISTRATION_NUMBER } from '@/lib/beaip/constants'

const shipment = {
  shipmentNumber: 'SHP-2026-00001',
  clientId: 'client-1',
  declarationOfficeId: 'office-1',
}

describe('declaration workflow constraints', () => {
  it('defaults a shipment to sea, Box/CARTON, and an original declaration', () => {
    const parsed = shipmentCreateSchema.parse(shipment)
    expect(parsed.transportMode).toBe('SEA')
    expect(parsed.packageType).toBe('CARTON')
    expect(parsed.declarationFunctionCode).toBe('9')
  })

  it('allows only sea and air transport for shipment entry', () => {
    expect(shipmentCreateSchema.safeParse({ ...shipment, transportMode: 'AIR' }).success).toBe(true)
    expect(shipmentCreateSchema.safeParse({ ...shipment, transportMode: 'LAND' }).success).toBe(false)
  })

  it('does not permit an artifact caller to override function 9', () => {
    expect(declarationArtifactSchema.safeParse({ declarationType: 'C13', functionCode: '5' }).success).toBe(false)
    expect(ORIGINAL_DECLARATION_FUNCTION_CODE).toBe('9')
    expect(TFP_COMPANY_REGISTRATION_NUMBER).toBe('131249792')
  })

  it('limits manifest transport assets to sea vessels and aircraft', () => {
    const asset = { carrierId: 'carrier-1', name: 'Island Trader' }
    expect(vesselCreateSchema.safeParse({ ...asset, mode: 'SEA', imoNumber: 'IMO123' }).success).toBe(true)
    expect(vesselCreateSchema.safeParse({ ...asset, mode: 'AIR' }).success).toBe(true)
    expect(vesselCreateSchema.safeParse({ ...asset, mode: 'LAND' }).success).toBe(false)
  })

  it('requires a route to connect two different ports', () => {
    expect(journeyCreateSchema.safeParse({ originPortId: 'port-1', destinationPortId: 'port-2' }).success).toBe(true)
    expect(journeyCreateSchema.safeParse({ originPortId: 'port-1', destinationPortId: 'port-1' }).success).toBe(false)
  })
})
