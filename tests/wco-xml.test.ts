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
import { TFP_DECLARANT_NAME, TFP_QA_PARTY_ID } from '@/lib/beaip/constants'

const hasXmllint = !spawnSync('xmllint', ['--version'], { encoding: 'utf8' }).error

import { fixture } from './fixtures/declaration'

const ACCEPTANCE = new Date('2026-07-31T14:00:00.000Z')

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
  it('emits the configured filing identity as Submitter/ID', () => {
    const xml = buildWcoDeclarationXml(fixture())
    expect(xml).toMatch(/<Submitter>\s*<ID>TEST-SUBMITTER<\/ID>\s*<\/Submitter>/)
  })

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
      'TradeTerms',
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

  it('uses the approved declaration header values and reference conventions', () => {
    const xml = build()
    expect(xml).toContain('<FunctionalReferenceID>SUBMITDEC000000001</FunctionalReferenceID>')
    expect(xml).toContain('<TotalGrossMassMeasure unitCode="LB">20.000</TotalGrossMassMeasure>')
    expect(xml).toContain('<DeclarationOffice>\n        <ID>NASACP</ID>')
    expect(xml).toContain(`<Declarant>\n        <Name>${TFP_DECLARANT_NAME}</Name>`)
    expect(xml).not.toContain('<UCR>')
    expect(xml).not.toContain('<TraderAssignedReferenceID>')
  })

  it('omits optional BorderTransportMeans until its values are confirmed', () => {
    const xml = build()
    expect(xml).not.toContain('<BorderTransportMeans>')
    // The separate consignment arrival means remains populated from manifest data.
    expect(xml).toContain('<ArrivalTransportMeans>')
  })

  it('carries currencyID on amounts and links lines to invoices', () => {
    const xml = build()
    expect(xml).toContain('<ValueAmount currencyID="BSD">100.00</ValueAmount>')
    expect(xml).toContain('<ExitToEntryChargeAmount currencyID="BSD">110.00</ExitToEntryChargeAmount>')
    // Item → invoice link: AdditionalDocument type 380 with the invoice number.
    expect(xml).toContain('<ID>TEST-INVOICE-B</ID>')
    expect(xml).toContain('<TypeCode>380</TypeCode>')
  })

  it('never emits insurance fields or charge code 67', () => {
    const xml = build()
    expect(xml).not.toContain('<InsuranceAmount')
    expect(xml).not.toContain('<ChargesTypeCode>67</ChargesTypeCode>')
  })

  it('emits undotted Classification IDs', () => {
    const xml = build()
    expect(xml).toContain('<ID>22083000</ID>')
    expect(xml).toContain('<ID>94035090</ID>')
    expect(xml).not.toContain('<ID>2208.30.00</ID>')
    expect(xml).not.toContain('<ID>9403.50.90</ID>')
  })

  it('represents freight as a BSD FreightChargeAmount in schema order', () => {
    const xml = build()
    const shipmentSection = xml.match(
      /<GoodsShipment>([\s\S]*?)<Destination>/,
    )?.[1]
    expect(shipmentSection).toBeDefined()
    const valuations = [...shipmentSection!.matchAll(
      /<CustomsValuation>([\s\S]*?)<\/CustomsValuation>/g,
    )].map((match) => match[1]!)

    expect(valuations).toHaveLength(2)
    expect(valuations[0]).toContain('<FreightChargeAmount currencyID="BSD">10.00</FreightChargeAmount>')
    expect(valuations[1]).not.toContain('<FreightChargeAmount')
    expect(xml).not.toContain('<ChargesTypeCode>64</ChargesTypeCode>')

    const valuationOrder = childOrder(xml, 'CustomsValuation')
    expect(valuationOrder).toEqual([
      'FreightChargeAmount',
      'ChargeDeduction',
    ])
  })

  it('uses the Customs-confirmed each UOM while preserving specific assessment units', () => {
    const xml = build()
    expect(xml).toContain('<TotalPackageQuantity unitCode="EA">2</TotalPackageQuantity>')
    expect(xml).toContain('<TariffQuantity unitCode="EA">2</TariffQuantity>')
    expect(xml).toContain('<TariffQuantity unitCode="LTR">1</TariffQuantity>')
    expect(xml.match(/<QuantityQuantity unitCode="EA">1<\/QuantityQuantity>/g)).toHaveLength(2)
    expect(xml.match(/<Packaging>/g)).toHaveLength(2)
    const arrival = childOrder(xml, 'ArrivalTransportMeans')
    expect(arrival).toEqual(['Name', 'TypeCode', 'RegistrationNationalityCode'])
    expect(xml).toContain('<TypeCode>1</TypeCode>') // SEA → 1
  })

  it('applies the Customs-confirmed QA locations, identities, CPC and omissions', () => {
    const xml = build()
    expect(xml).toMatch(
      new RegExp(`<Declarant>\\s*<Name>${TFP_DECLARANT_NAME}</Name>\\s*<ID>${TFP_QA_PARTY_ID}</ID>\\s*</Declarant>`),
    )
    expect(xml).toMatch(/<GoodsLocation>\s*<ID>NASACP<\/ID>\s*<\/GoodsLocation>/)
    expect(xml).toMatch(/<UnloadingLocation>\s*<ID>USPBI<\/ID>/)
    expect(xml).toMatch(/<ExitOffice>\s*<ID>USPBI<\/ID>\s*<\/ExitOffice>/)
    expect(xml).toMatch(
      new RegExp(`<Exporter>\\s*<Name>TEST_SUPPLIER_A</Name>\\s*<ID>${TFP_QA_PARTY_ID}</ID>`),
    )
    expect(xml).not.toContain('<TransportContractDocument>')
    expect(xml.match(/<CurrentCode>400000<\/CurrentCode>/g)).toHaveLength(2)
    expect(xml.match(/<CurrentCode>400<\/CurrentCode>/g)).toHaveLength(1)
    expect(xml).toContain('<GovernmentProcedure>\n        <CurrentCode>400</CurrentCode>')

    const invoices = [...xml.matchAll(/<Invoice>([\s\S]*?)<\/Invoice>/g)]
      .map((match) => match[1]!)
    expect(invoices).toHaveLength(2)
    expect(invoices.every((invoice) => !invoice.includes('<TypeCode>'))).toBe(true)
  })

  it('refuses to silently omit Packaging when an item has no package quantity', () => {
    const input = fixture()
    input.lines[0]!.packageCount = null
    expect(() => buildWcoDeclarationXml(input)).toThrow(/package count is required/i)
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
