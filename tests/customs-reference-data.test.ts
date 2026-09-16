import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { CPC_CODES, CPC_GROUPS, CUSTOMS_PORTS, CUSTOMS_UOMS, cpcsForGroup, isCpcInGroup } from '@/lib/customs/reference-data'
import rawCpcs from '@/lib/customs/data/cpc-codes.json'
import { normalizeImportCpc } from '@/lib/customs/normalization'
import { lineItemCreateSchema, manifestCreateSchema } from '@/lib/validation/schemas'
import { assertLineCustomsReferences, resolveShipmentCustomsPort } from '@/server/services/customs-reference-validation'
import { invoicesService } from '@/server/services/invoices.service'
import { catalogService } from '@/server/services/catalog.service'
import { buildWcoDeclarationXml } from '@/lib/beaip/wco-xml'
import { toBeaipDeclaration, partitionBeaipDeclaration, type DeclarationSource } from '@/server/services/declaration-mapper'
import type { TenantClient } from '@/lib/db/tenant-client'
import { fixture } from './fixtures/declaration'

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }))
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false })

describe('supplied Customs reference lists', () => {
  it('preserves all source rows, unique group/code pairs, ports and UOMs', () => {
    expect(rawCpcs).toHaveLength(720)
    expect(new Set(rawCpcs.map((row) => row.groupCode)).size).toBe(71)
    expect(CPC_GROUPS).toHaveLength(63)
    expect(CUSTOMS_PORTS).toHaveLength(151)
    expect(CUSTOMS_UOMS).toHaveLength(42)
    expect(new Set(CPC_CODES.map((r) => `${r.groupCode}:${r.code}`)).size).toBe(CPC_CODES.length)
    expect(cpcsForGroup('400').map((r) => r.code)).toEqual(['400000'])
    expect(isCpcInGroup('400003', '400')).toBe(false)
    expect(cpcsForGroup('400').some((r) => r.code === '4098180020')).toBe(false)
  })

  it('uses explicit membership for duplicate codes and non-prefix groups', () => {
    expect(isCpcInGroup('4098010010FS', 'F001')).toBe(true)
    expect(isCpcInGroup('4098010010FS', 'H4098S')).toBe(true)
    expect(isCpcInGroup('4098010010FS', '4098')).toBe(false)
    expect(normalizeImportCpc(' 40981a0010 ')).toBe('40981A0010')
    expect(isCpcInGroup('40981A0010', '4098')).toBe(true)
  })

  it('accepts every supplied UOM and rejects commercial aliases and unknown codes', () => {
    const line = { invoiceId: 'i', hsCode: '94035090', cpcCode: '400000', description: 'Furniture', quantity: '10', unitPrice: '1', totalValue: '10' }
    for (const { code } of CUSTOMS_UOMS) expect(lineItemCreateSchema.safeParse({ ...line, unit: code }).success, code).toBe(true)
    for (const unit of ['PCS', 'L', 'UNKNOWN']) expect(lineItemCreateSchema.safeParse({ ...line, unit }).success).toBe(false)
    expect(lineItemCreateSchema.safeParse({ ...line, cpcCode: '4098' }).success).toBe(false)
    expect(manifestCreateSchema.safeParse({ manifestNumber: 'M', voyageId: 'V', customsPortCode: 'NASACP' }).success).toBe(true)
    expect(manifestCreateSchema.safeParse({ manifestNumber: 'M', voyageId: 'V', customsPortCode: 'BSNAS' }).success).toBe(false)
  })

  it('blocks invalid group/code combinations on service create and update', async () => {
    const create = vi.fn(), update = vi.fn()
    const db = {
      invoice: { findUnique: vi.fn().mockResolvedValue({ id: 'i', shipmentId: 's' }) },
      shipment: { findUnique: vi.fn().mockResolvedValue({ id: 's', status: 'DRAFT', cpcGroupCode: '400' }) },
      lineItem: { create, update, findUnique: vi.fn().mockResolvedValue({ id: 'l', cpcCode: '400000', unit: 'EA', invoice: { shipmentId: 's' } }) },
    } as unknown as TenantClient
    await expect(invoicesService.createLineItem(db, { userId: "test" }, { invoiceId: 'i', cpcCode: '4098180020', unit: 'EA' })).rejects.toThrow(/not available/)
    await expect(invoicesService.updateLineItem(db, { userId: "test" }, 'l', { cpcCode: '4098180020' })).rejects.toThrow(/not available/)
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(() => assertLineCustomsReferences('4098', '4098180020', 'KGM')).not.toThrow()
  })

  it('uses the selected manifest port and refuses missing/cross-tenant manifests', async () => {
    const findUnique = vi.fn().mockResolvedValue({ customsPortCode: 'GBIFCP' })
    const db = { manifest: { findUnique } } as unknown as TenantClient
    expect(await resolveShipmentCustomsPort(db, 'm', 'NASACP')).toBe('GBIFCP')
    findUnique.mockResolvedValueOnce(null)
    await expect(resolveShipmentCustomsPort(db, 'other-tenant', 'NASACP')).rejects.toThrow(/Manifest/)
    findUnique.mockResolvedValueOnce({ customsPortCode: null })
    await expect(resolveShipmentCustomsPort(db, 'm', 'NASACP')).rejects.toThrow(/manifest/)
    expect(await resolveShipmentCustomsPort(db, null, 'NASACP')).toBe('NASACP')
  })

  it('invalidates every linked draft atomically when a manifest changes', async () => {
    const updateMany = vi.fn()
    const tx = { manifest: { update: vi.fn().mockResolvedValue({ id: 'm', customsPortCode: 'GBIFCP' }) }, shipment: { updateMany } }
    const db = {
      $organizationId: 'org-a',
      manifest: { findUnique: vi.fn().mockResolvedValue({ id: 'm', customsPortCode: 'NASACP' }) },
      $tenantTransaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    } as unknown as TenantClient
    await catalogService.updateManifest(db, { userId: "test" }, 'm', { customsPortCode: 'GBIFCP' })
    expect(updateMany).toHaveBeenCalledWith({ where: { manifestId: 'm', organizationId: 'org-a', status: 'DRAFT' }, data: { calculatedAt: null, updatedAt: expect.any(Date) } })
  })

  it('maps the current manifest port into declaration office and goods location', () => {
    const source = {
      declarationDate: new Date('2026-09-16'), submittedAt: null,
      organization: { companyRegistrationNumber: 'TEST' }, client: { name: 'Test', tinNumber: 'TEST' },
      manifest: { customsPortCode: 'GBIFCP', voyage: { vessel: { name: 'Test vessel' }, journey: { destinationPort: { unLocode: 'BSFPO' }, originPort: { unLocode: 'USMIA', country: 'US' } } } },
      goodsLocationCode: 'NASACP', cpcGroupCode: '4098', shipmentNumber: 'SHP-1', regimeCode: '4',
      invoices: [], grossWeightLb: null, packageCount: 1,
      totalCifValue: '0', totalDuty: '0', totalVat: '0', totalLevy: '0', totalExcise: '0', processingFee: '0', totalPayable: '0',
    } as unknown as DeclarationSource
    const output = toBeaipDeclaration(source, 'C13', 'TEST')
    expect(output.customsOfficeCode).toBe('GBIFCP')
    expect(output.transport.goodsLocationCode).toBe('GBIFCP')
    expect(output.transport.entryPortCode).toBe('BSFPO')
    expect(output.transport.unloadingPortCode).toBe('FPO')
    expect(output.declarationGroupCode).toBe('4098')
  })

  it('matches the successful sample group, item CPCs, quantities, UOMs and offices', () => {
    const sample = parser.parse(readFileSync('tests/fixtures/customs-success-excerpt.xml', 'utf8')).Declaration
    const input = fixture()
    input.declarationGroupCode = '4098'
    input.lines = input.lines.map((line, i) => ({ ...line, cpcCode: '4098180020', hsCode: i === 0 ? '01029000' : '40013000', quantity: '10', unit: i === 0 ? 'EA' : 'LB' }))
    input.transport.unloadingPortCode = 'NAS'
    input.invoices[1]!.incotermCode = 'FOB'
    const output = parser.parse(buildWcoDeclarationXml(input)).Declaration
    expect(output.GovernmentProcedure).toEqual(sample.GovernmentProcedure)
    expect(output.DeclarationOffice).toEqual(sample.DeclarationOffice)
    expect(output.GoodsShipment.EntryOffice).toEqual(sample.GoodsShipment.EntryOffice)
    const items = output.GoodsShipment.GovernmentAgencyGoodsItem
    for (let i = 0; i < 2; i++) {
      const expected = sample.GoodsShipment.GovernmentAgencyGoodsItem[i]
      expect(items[i].GovernmentProcedure).toEqual(expected.GovernmentProcedure)
      expect(items[i].Commodity.GoodsMeasure.TariffQuantity).toEqual(expected.Commodity.GoodsMeasure.TariffQuantity)
      expect(items[i].Commodity.Classification.ID).toEqual(expected.Commodity.Classification.ID)
    }
    expect(output.GoodsShipment.Consignment.GoodsLocation).toEqual(sample.GoodsShipment.Consignment.GoodsLocation)
    expect(output.GoodsShipment.TradeTerms[0]).toEqual(sample.GoodsShipment.TradeTerms[0])
  })

  it('keeps different full CPCs within one group in one unsplit declaration', () => {
    const input = fixture()
    input.declarationGroupCode = '4098'
    input.lines[0]!.cpcCode = '4098180010'
    input.lines[1]!.cpcCode = '4098180020'
    const output = partitionBeaipDeclaration(input, 'test')
    expect(output).toHaveLength(1)
    expect(output[0]!.declarationGroupCode).toBe('4098')
    expect(output[0]!.lines).toHaveLength(2)
  })
})
