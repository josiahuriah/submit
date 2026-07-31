/**
 * WCO declaration XML builder — structural contract tests.
 *
 * The TFB_WCO_DEC v1.4.4 schema validates element ORDER inside every complex
 * type, so these tests pin ordering, the namespace, the unqualified
 * DateTimeString convention, and the omit-DutyTaxFee rule. When xmllint is
 * available the output is additionally validated against the real XSD (+ the
 * committed common-types stub) in docs/tfp/.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { buildWcoDeclarationXml, WCO_DECLARATION_NS } from '@/lib/beaip/wco-xml'
import type { BeaipDeclaration } from '@/lib/beaip'

const hasXmllint = !spawnSync('xmllint', ['--version'], { encoding: 'utf8' }).error

function fixture(): BeaipDeclaration {
  return {
    declarationType: 'C13',
    regimeCode: '4',
    functionalReferenceId: 'SHP-2026-00042',
    brokerReference: 'SHP-2026-00042',
    customsOfficeCode: 'NAS',
    submitterId: 'CRN-12345',
    declarant: { name: 'Bahama Brokerage Ltd', id: 'TIN-ORG-1', address: null },
    importer: {
      name: 'Island Imports Ltd',
      id: 'TIN-CLIENT-1',
      address: { cityName: null, countryCode: null, line: '12 Bay St, Nassau', postcode: null },
    },
    consignee: { name: 'Island Imports Ltd', id: 'TIN-CLIENT-1', address: null },
    blNumber: 'BL-778899',
    packageCount: 40,
    packageUom: 'CARTON',
    grossWeightKg: '512.500',
    transport: {
      vesselName: 'Tropic Freedom',
      transportMode: 'SEA',
      arrivalDate: '2026-07-20T12:00:00.000Z',
      containerNumber: 'TCLU7305421',
      manifestNumber: 'MAN-2026-0142',
      unloadingPortCode: 'BSNAS',
      entryPortCode: 'BSNAS',
      exitPortCode: 'USMIA',
      exportCountryCode: 'US',
    },
    invoices: [
      {
        invoiceNumber: 'INV-1001',
        invoiceDate: '2026-07-01T00:00:00.000Z',
        currency: 'USD',
        subTotal: '1500.00',
        supplier: {
          name: 'Miami Wholesale Co',
          id: null,
          address: { cityName: null, countryCode: 'US', line: '400 NW 7th Ave', postcode: null },
        },
        freightApportioned: '120.00',
        insuranceApportioned: '30.00',
        otherApportioned: '0.00',
      },
      {
        invoiceNumber: 'INV-1002',
        invoiceDate: null,
        currency: 'USD',
        subTotal: '800.00',
        supplier: { name: 'Georgia Traders', id: null, address: null },
        freightApportioned: '80.00',
        insuranceApportioned: '20.00',
        otherApportioned: '10.00',
      },
    ],
    totalCifValue: '2560.00',
    totalDuty: '640.00',
    totalVat: '320.00',
    totalLevy: '0.00',
    totalExcise: '0.00',
    processingFee: '25.60',
    totalPayable: '988.16',
    lines: [
      {
        lineNumber: 1,
        invoiceNumber: 'INV-1001',
        hsCode: '2208.30.00',
        cpcCode: '4000',
        description: 'Whisky 750ml',
        commercialDescription: 'Spirits',
        countryOfOrigin: 'GB',
        quantity: '120',
        unit: 'L',
        weightKg: '150.000',
        totalValue: '1500.00',
        currency: 'USD',
        freightApportioned: '120.00',
        insuranceApportioned: '30.00',
        otherApportioned: '0.00',
        cifValue: '1650.00',
        dutyAmount: '600.00',
        vatAmount: '225.00',
        levyAmount: '0.00',
        exciseAmount: '0.00',
      },
      {
        lineNumber: 1,
        invoiceNumber: 'INV-1002',
        hsCode: '6109.10.00',
        cpcCode: '4000',
        description: 'Cotton t-shirts',
        commercialDescription: null,
        countryOfOrigin: null,
        quantity: '500',
        unit: 'PCS',
        weightKg: null,
        totalValue: '800.00',
        currency: 'USD',
        freightApportioned: '80.00',
        insuranceApportioned: '20.00',
        otherApportioned: '10.00',
        cifValue: '910.00',
        dutyAmount: '40.00',
        vatAmount: '95.00',
        levyAmount: '0.00',
        exciseAmount: '0.00',
      },
    ],
  }
}

const ACCEPTANCE = new Date('2026-07-31T10:00:00')

function build(): string {
  return buildWcoDeclarationXml(fixture(), { acceptanceDateTime: ACCEPTANCE })
}

/** Ordered child element names of the first node named `name` (preserveOrder parse). */
function childOrder(xml: string, name: string): string[] {
  const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false }).parse(xml) as {
    [k: string]: unknown
  }[]
  function find(nodes: { [k: string]: unknown }[]): { [k: string]: unknown }[] | null {
    for (const node of nodes) {
      const key = Object.keys(node).find((k) => !k.startsWith(':@') && k !== '#text')
      if (!key) continue
      const children = node[key] as { [k: string]: unknown }[]
      if (key === name) return children
      if (Array.isArray(children)) {
        const hit = find(children)
        if (hit) return hit
      }
    }
    return null
  }
  const children = find(parsed)
  if (!children) throw new Error(`element ${name} not found`)
  return children
    .map((c) => Object.keys(c).find((k) => !k.startsWith(':@') && k !== '#text')!)
    .filter(Boolean)
}

describe('buildWcoDeclarationXml', () => {
  it('declares the target namespace on the root (the sample-file trap)', () => {
    expect(build()).toContain(`<Declaration xmlns="${WCO_DECLARATION_NS}">`)
  })

  it('orders Declaration children per the XSD sequence', () => {
    const order = childOrder(build(), 'Declaration')
    expect(order).toEqual([
      'AcceptanceDateTime',
      'FunctionCode',
      'FunctionalReferenceID',
      'TypeCode',
      'TotalGrossMassMeasure',
      'TotalPackageQuantity',
      'Submitter',
      'DeclarationOffice',
      'BorderTransportMeans',
      'Declarant',
      'GoodsShipment',
      'GovernmentProcedure',
    ])
  })

  it('orders GoodsShipment children per the XSD sequence', () => {
    const order = childOrder(build(), 'GoodsShipment')
    expect(order).toEqual([
      'Consignee',
      'Consignment',
      'CustomsValuation',
      'CustomsValuation', // one per invoice, order-linked to Invoice elements
      'Destination',
      'EntryOffice',
      'ExitOffice',
      'ExportCountry',
      'Exporter',
      'GovernmentAgencyGoodsItem',
      'GovernmentAgencyGoodsItem',
      'Importer',
      'Invoice',
      'Invoice',
      'Supplier',
      'Supplier',
      'UCR',
    ])
  })

  it('emits unqualified DateTimeString with the spec formatCode', () => {
    const xml = build()
    expect(xml).toContain('<DateTimeString xmlns="" formatCode="yyyy-MM-dd HH:mm:ss ">')
    expect(xml).toContain('2026-07-31 10:00:00')
  })

  it('omits DutyTaxFee — amounts are Customs internal use on incoming messages', () => {
    expect(build()).not.toContain('DutyTaxFee')
  })

  it('carries currencyID on amounts and links lines to invoices', () => {
    const xml = build()
    expect(xml).toContain('<ValueAmount currencyID="USD">1500.00</ValueAmount>')
    expect(xml).toContain('<ExitToEntryChargeAmount currencyID="BSD">1650.00</ExitToEntryChargeAmount>')
    // Item → invoice link: AdditionalDocument type 380 with the invoice number.
    expect(xml).toContain('<ID>INV-1002</ID>')
    expect(xml).toContain('<TypeCode>380</TypeCode>')
    // BL 705 and manifest 785 transport contract documents.
    expect(xml).toContain('<TypeCode>705</TypeCode>')
    expect(xml).toContain('<TypeCode>785</TypeCode>')
  })

  it('maps placeholder code tables (transport mode, package UOM)', () => {
    const xml = build()
    expect(xml).toContain('<TotalPackageQuantity unitCode="CT">40</TotalPackageQuantity>')
    const border = childOrder(xml, 'BorderTransportMeans')
    expect(border).toEqual(['Name', 'TypeCode', 'ArrivalDateTime', 'TransportEquipment'])
    expect(xml).toContain('<TypeCode>1</TypeCode>') // SEA → 1
  })

  it.skipIf(!hasXmllint)('validates against TFB_WCO_DEC_v1.4.4.xsd + common-types stub', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wco-'))
    const xmlPath = path.join(dir, 'declaration.xml')
    writeFileSync(xmlPath, build(), 'utf8')
    const xsd = path.join(process.cwd(), 'docs', 'tfp', 'TFB_WCO_DEC_v1.4.4.xsd')
    const res = spawnSync('xmllint', ['--noout', '--schema', xsd, xmlPath], { encoding: 'utf8' })
    expect(res.stderr).toContain('validates')
    expect(res.status).toBe(0)
  })
})
