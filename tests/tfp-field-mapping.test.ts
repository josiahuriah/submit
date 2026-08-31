import { describe, expect, it } from 'vitest'
import { preflightTfpDeclaration, TFP_FIELD_MAPPINGS } from '@/lib/beaip/tfp-field-mapping'
import type { BeaipDeclaration } from '@/lib/beaip'
import {
  buildFunctionalReferenceId,
  buildTraderAssignedReferenceId,
} from '@/lib/beaip/references'
import { partitionBeaipDeclaration } from '@/server/services/declaration-mapper'

function declaration(): BeaipDeclaration {
  return {
    isSplitDeclaration: false,
    declarationGroupCode: '400',
    declarationSequence: 1,
    declarationType: 'C13',
    functionCode: '9',
    declarationDate: '2026-08-08T00:00:00.000Z',
    regimeCode: '4',
    functionalReferenceId: '2026DEC0001234567',
    brokerReference: '201800OREF02331212',
    customsOfficeCode: 'NASACP',
    submitterId: 'CR-12345',
    declarant: { name: 'Atlas Brokers', id: null, address: null },
    importer: { name: 'Importer Ltd', id: null, address: null },
    consignee: { name: 'Importer Ltd', id: null, address: null },
    blNumber: 'BL-1',
    packageCount: 1,
    packageUom: 'CARTON',
    grossWeightLb: '10',
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
      invoiceNumber: 'INV-1', invoiceDate: null, currency: 'BSD', exchangeRate: '1',
      incotermCode: 'FOB', incotermLocation: 'Miami', subTotal: '100.00',
      supplier: { name: 'Supplier', id: null, address: null },
      freightApportioned: '10.00', insuranceApportioned: '0.00', otherApportioned: '0.00',
    }],
    totalCifValue: '100.00', totalDuty: '0.00', totalVat: '11.00', totalLevy: '0.00',
    totalExcise: '0.00', processingFee: '10.00', totalPayable: '21.00',
    lines: [{
      lineNumber: 1, invoiceNumber: 'INV-1', hsCode: '61091000', cpcCode: '400',
      description: 'Cotton t-shirts', commercialDescription: null, countryOfOrigin: 'US',
      quantity: '1', unit: 'PCS', weightLb: '10', netWeightLb: '9', packageCount: 1,
      packageTypeCode: 'CT', totalValue: '100.00', currency: 'BSD',
      freightApportioned: '10.00', insuranceApportioned: '0.00', otherApportioned: '0.00',
      cifValue: '100.00', dutyAmount: '0.00', vatAmount: '11.00', levyAmount: '0.00',
      exciseAmount: '0.00', dutyAssessmentQuantity: null, dutyAssessmentUnit: null,
      exciseAssessmentQuantity: null, exciseAssessmentUnit: null,
    }],
  }
}

describe('TFP field mapping preflight', () => {
  it('partitions a split shipment into independently referenced CPC declarations', () => {
    const input = declaration()
    input.isSplitDeclaration = true
    input.lines[0]!.freightApportioned = '7.50'
    input.lines.push({
      ...input.lines[0]!,
      lineNumber: 2,
      cpcCode: '4098',
      hsCode: '94035090',
      weightLb: '5',
      netWeightLb: '4',
      freightApportioned: '2.50',
    })
    // Two $11 line VAT amounts plus $1 VAT on the $10 processing fee.
    input.totalCifValue = '200.00'
    input.totalVat = '23.00'
    input.totalPayable = '33.00'
    const result = partitionBeaipDeclaration(input, 'batch-1')
    expect(result.map((item) => item.declarationGroupCode)).toEqual(['400', '4098'])
    expect(result[0]!.functionalReferenceId).not.toBe(result[1]!.functionalReferenceId)
    expect(result[0]!.lines).toHaveLength(1)
    expect(result[1]!.lines).toHaveLength(1)
    expect(result[0]!.grossWeightLb).toBe('10.000')
    expect(result[1]!.grossWeightLb).toBe('5.000')
    expect(result.map((item) => item.processingFee)).toEqual(['5.00', '5.00'])
    expect(result.map((item) => item.totalVat)).toEqual(['11.50', '11.50'])
    expect(result.map((item) => item.totalPayable)).toEqual(['16.50', '16.50'])
    expect(result.reduce((total, item) => total + Number(item.processingFee), 0)).toBe(10)
  })

  it('preserves processing-fee VAT in an unsplit declaration', () => {
    const input = declaration()
    // $100 CIF at 10% VAT = $10; $10 fee at 10% adds $1 VAT.
    input.lines[0]!.vatAmount = '10.00'
    const [result] = partitionBeaipDeclaration(input, 'unsplit-fee-vat')
    expect(result!.totalVat).toBe('11.00')
    expect(result!.processingFee).toBe('10.00')
    expect(result!.totalPayable).toBe('21.00')
  })

  it('refuses mixed CPCs unless the broker selected split declaration', () => {
    const input = declaration()
    input.lines.push({ ...input.lines[0]!, lineNumber: 2, cpcCode: '4098' })
    expect(() => partitionBeaipDeclaration(input, 'batch-2')).toThrow(/split declaration option/)
  })

  it('builds stable Click2Clear-shaped review references', () => {
    expect(buildFunctionalReferenceId('2026-08-08T00:00:00.000Z', 'SHP-2026-1234567'))
      .toBe('2026DEC0001234567')
    expect(buildTraderAssignedReferenceId('2018-08-08T00:00:00.000Z', 'SHP-2331212'))
      .toBe('201800OREF02331212')
  })

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

  it('blocks references that do not follow the Click2Clear review conventions', () => {
    const input = declaration()
    input.functionalReferenceId = 'SHP-2026-00001'
    input.brokerReference = 'SHP-2026-00001'
    const result = preflightTfpDeclaration(input)
    expect(result.ready).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'Declaration/FunctionalReferenceID' }),
      expect.objectContaining({
        field: 'Declaration/GoodsShipment/UCR/TraderAssignedReferenceID',
      }),
    ]))
  })
})
