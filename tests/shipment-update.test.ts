import { describe, expect, it } from 'vitest'
import { shipmentUpdateInvalidatesCalculation } from '@/server/services/shipments.service'

describe('shipment calculation staleness', () => {
  it('invalidates calculations when declaration date, value, or apportionment inputs change', () => {
    for (const field of ['clientId', 'declarationDate', 'grossWeightLb', 'netWeightLb', 'freightCharge', 'insuranceCharge', 'otherCharges']) {
      expect(shipmentUpdateInvalidatesCalculation({ [field]: 'changed' }), field).toBe(true)
    }
  })

  it('keeps calculations current for XML-only identity and routing edits', () => {
    expect(shipmentUpdateInvalidatesCalculation({ blNumber: 'BL-NEW', warehouseCode: 'WH1' })).toBe(false)
  })
})
