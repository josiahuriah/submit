import { describe, expect, it } from 'vitest'
import { preflightTfpDeclaration, TFP_FIELD_MAPPINGS } from '@/lib/beaip/tfp-field-mapping'
import type { BeaipDeclaration } from '@/lib/beaip'

function declaration(): BeaipDeclaration {
  return {
    declarationType: 'C13',
    functionCode: '9',
    declarationDate: '2026-08-08T00:00:00.000Z',
    regimeCode: '4',
    functionalReferenceId: 'SHP-2026-00001',
    brokerReference: 'SHP-2026-00001',
    customsOfficeCode: 'NAS',
    submitterId: 'CR-12345',
    declarant: { name: 'Broker Ltd', id: null, address: null },
    importer: { name: 'Importer Ltd', id: null, address: null },
    consignee: { name: 'Importer Ltd', id: null, address: null },
    blNumber: 'BL-1',
    packageCount: 1,
    packageUom: 'CARTON',
    grossWeightKg: '10',
    transport: {
      vesselName: null,
      transportMode: 'SEA',
      arrivalDate: null,
      containerNumber: null,
      containerSealNumber: null,
      containerFullnessCode: null,
      manifestNumber: null,
      unloadingPortCode: 'BSNAS',
      entryPortCode: 'BSNAS',
      exitPortCode: 'USMIA',
      exportCountryCode: 'US',
      transportNationalityCode: null,
      goodsLocationCode: null,
      warehouseCode: null,
    },
    invoices: [{
      invoiceNumber: 'INV-1', invoiceDate: null, currency: 'USD', exchangeRate: '1',
      incotermCode: 'FOB', incotermLocation: 'Miami', subTotal: '100.00',
      supplier: { name: 'Supplier', id: null, address: null },
      freightApportioned: '0.00', insuranceApportioned: '0.00', otherApportioned: '0.00',
    }],
    totalCifValue: '100.00', totalDuty: '0.00', totalVat: '11.00', totalLevy: '0.00',
    totalExcise: '0.00', processingFee: '10.00', totalPayable: '21.00',
    lines: [{
      lineNumber: 1, invoiceNumber: 'INV-1', hsCode: '6109.10.00', cpcCode: '4000',
      description: 'Cotton t-shirts', commercialDescription: null, countryOfOrigin: 'US',
      quantity: '1', unit: 'PCS', weightKg: '10', netWeightKg: '9', packageCount: 1,
      packageTypeCode: 'CT', totalValue: '100.00', currency: 'USD',
      freightApportioned: '0.00', insuranceApportioned: '0.00', otherApportioned: '0.00',
      cifValue: '100.00', dutyAmount: '0.00', vatAmount: '11.00', levyAmount: '0.00',
      exciseAmount: '0.00', dutyAssessmentQuantity: null, dutyAssessmentUnit: null,
      exciseAssessmentQuantity: null, exciseAssessmentUnit: null,
    }],
  }
}

describe('TFP field mapping preflight', () => {
  it('keeps the executable matrix free of duplicate element rows', () => {
    const keys = TFP_FIELD_MAPPINGS.map((row) => `${row.section}/${row.element}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('accepts a complete declaration while surfacing withheld code-list warnings', () => {
    const result = preflightTfpDeclaration(declaration())
    expect(result.ready).toBe(true)
    expect(result.issues.every((issue) => issue.severity === 'WARNING')).toBe(true)
  })

  it('blocks a missing company registration number instead of substituting TIN or licence', () => {
    const input = declaration()
    input.submitterId = ''
    const result = preflightTfpDeclaration(input)
    expect(result.ready).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'BLOCKER',
      field: 'Declaration/Submitter/ID',
    }))
  })
})
