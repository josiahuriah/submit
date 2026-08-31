import { describe, expect, it } from 'vitest'
import {
  declarationArtifactSchema,
  invoiceCreateSchema,
  journeyCreateSchema,
  lineItemCreateSchema,
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
    expect(parsed.isSplitDeclaration).toBe(false)
  })

  it('accepts punctuated HS input but produces exactly eight stored digits', () => {
    const parsed = lineItemCreateSchema.parse({
      invoiceId: 'invoice-1', hsCode: '9403.50.90', cpcCode: '400',
      description: 'Furniture', quantity: '1', unitPrice: '10', totalValue: '10.00',
    })
    expect(parsed.hsCode).toBe('94035090')
    expect(lineItemCreateSchema.safeParse({ ...parsed, cpcCode: '4000' }).success).toBe(false)
  })

  it('accepts only broker-converted BSD invoice values', () => {
    const invoice = {
      shipmentId: 'shipment-1', supplierId: 'supplier-1', invoiceNumber: 'INV-1',
      invoiceDate: new Date(), subTotal: '10.00',
    }
    expect(invoiceCreateSchema.safeParse({ ...invoice, currency: 'BSD', exchangeRate: '1' }).success).toBe(true)
    expect(invoiceCreateSchema.safeParse({ ...invoice, currency: 'USD', exchangeRate: '1' }).success).toBe(false)
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
