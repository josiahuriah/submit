/**
 * Fresh-account workflow proof against the real development database.
 *
 * Registration and every subsequent step invoke the real API route handlers.
 * The mocked Next request-cookie store captures the httpOnly token produced
 * by registration, then the test presents it as a Bearer token: client → supplier → manifest →
 * shipment → invoice → tariff line → calculation → review XML download,
 * followed by brokerage invoice delivery and payment posting.
 * It requires the global reference seed and removes the tenant it creates.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'
import { basePrisma } from '@/lib/db/prisma'
import { createTenantClient } from '@/lib/db/tenant-client'
import { d } from '@/lib/calculations/money'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as createClient } from '@/app/api/clients/route'
import { POST as createSupplier } from '@/app/api/suppliers/route'
import { POST as createManifest } from '@/app/api/manifests/route'
import { POST as createShipment } from '@/app/api/shipments/route'
import { POST as createInvoice } from '@/app/api/invoices/route'
import { POST as createLineItem } from '@/app/api/invoices/[id]/line-items/route'
import { POST as calculateShipment } from '@/app/api/shipments/[id]/calculate/route'
import { POST as generateArtifact } from '@/app/api/shipments/[id]/artifacts/route'
import { GET as downloadXml } from '@/app/api/customs-entries/[id]/xml/route'
import { POST as createBrokerageInvoice } from '@/app/api/billing/invoices/route'
import { POST as sendBrokerageInvoice } from '@/app/api/billing/invoices/[id]/send/route'
import { POST as recordBrokeragePayment } from '@/app/api/billing/invoices/[id]/payments/route'

interface ReferenceData {
  voyageId: string
  officeId: string
  hsCodeId: string
}

const capturedSession = vi.hoisted(() => ({ token: '' }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (_name: string, value: string) => { capturedSession.token = value },
    delete: () => undefined,
  }),
}))

let organizationId: string | null = null
let token = ''
let references: ReferenceData

function request(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://submit.test${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function context(id?: string) {
  return { params: Promise.resolve(id ? { id } : {}) }
}

async function data<T>(response: NextResponse, expectedStatus: number): Promise<T> {
  const payload = await response.json() as { data?: T; error?: { code: string; message: string; details?: unknown } }
  expect(response.status, JSON.stringify(payload.error ?? payload)).toBe(expectedStatus)
  expect(payload.error, JSON.stringify(payload.error)).toBeUndefined()
  return payload.data as T
}

beforeAll(async () => {
  // The Prisma pg adapter can share one physical client in tests; keep these
  // fixture probes sequential to avoid overlapping client.query() calls.
  const voyage = await basePrisma.voyage.findFirst({ select: { id: true } })
  const office = await basePrisma.customsOffice.findFirst({ where: { isActive: true }, select: { id: true } })
  const hsCode = await basePrisma.hSCode.findUnique({ where: { code: '61091000' }, select: { id: true } })
  if (!voyage || !office || !hsCode) {
    throw new Error('Global seed missing — run `npm run db:seed` before the fresh-account workflow test')
  }
  references = { voyageId: voyage.id, officeId: office.id, hsCodeId: hsCode.id }
})

afterAll(async () => {
  if (organizationId) {
    // Reverse dependency order; this test owns the uniquely-created tenant.
    await basePrisma.customsSubmissionAttempt.deleteMany({ where: { organizationId } })
    await basePrisma.customsEntry.deleteMany({ where: { organizationId } })
    await basePrisma.customsSubmissionBatch.deleteMany({ where: { organizationId } })
    await basePrisma.lineItem.deleteMany({ where: { organizationId } })
    await basePrisma.invoice.deleteMany({ where: { organizationId } })
    await basePrisma.shipment.deleteMany({ where: { organizationId } })
    await basePrisma.manifest.deleteMany({ where: { organizationId } })
    await basePrisma.payment.deleteMany({ where: { organizationId } })
    await basePrisma.brokerageInvoice.deleteMany({ where: { organizationId } })
    await basePrisma.supplier.deleteMany({ where: { organizationId } })
    await basePrisma.client.deleteMany({ where: { organizationId } })
    await basePrisma.auditLog.deleteMany({ where: { organizationId } })
    await basePrisma.user.deleteMany({ where: { organizationId } })
    await basePrisma.organization.deleteMany({ where: { id: organizationId } })
  }
  await basePrisma.$disconnect()
})

describe('fresh account to Customs-review XML', () => {
  it('creates every prerequisite through the supported tenant workflow', async () => {
    const marker = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const registered = await data<{ user: { organization: { id: string } } }>(await register(request('/api/auth/register', 'POST', {
      organizationName: `E2E Brokerage ${marker}`,
      firstName: 'Fresh',
      lastName: 'Broker',
      email: `fresh-${marker}@submit.test`,
      password: 'FreshAccount123!',
    })), 201)
    organizationId = registered.user.organization.id
    token = capturedSession.token
    expect(token).not.toBe('')

    // Submitter/ID is mandatory in TFP v1.4.4. This is the same tenant-owned
    // organization value exposed in the declaration profile UI.
    const db = createTenantClient(organizationId)
    await db.organization.update({
      where: { id: organizationId },
      data: { companyRegistrationNumber: `REG-${marker}` },
    })

    const client = await data<{ id: string }>(await createClient(request('/api/clients', 'POST', {
      name: `E2E Importer ${marker}`,
      clientType: 'BUSINESS',
      tinNumber: `TIN-${marker}`,
      address: 'Bay Street',
      city: 'Nassau',
      countryCode: 'BS',
    }), context()), 201)

    const supplier = await data<{ id: string }>(await createSupplier(request('/api/suppliers', 'POST', {
      name: `E2E Supplier ${marker}`,
      country: 'US',
      address: '100 Export Way',
      city: 'Miami',
    }), context()), 201)

    const manifest = await data<{ id: string }>(await createManifest(request('/api/manifests', 'POST', {
      manifestNumber: `MAN-${marker}`,
      voyageId: references.voyageId,
      registeredAt: new Date().toISOString(),
    }), context()), 201)

    const shipment = await data<{ id: string; status: string }>(await createShipment(request('/api/shipments', 'POST', {
      shipmentNumber: `SHP-${marker}`,
      clientId: client.id,
      manifestId: manifest.id,
      declarationOfficeId: references.officeId,
      blNumber: `BL-${marker}`,
      goodsType: 'COMMERCIAL',
      packageType: 'CARTON',
      packageCount: 1,
      transportMode: 'SEA',
      grossWeightLb: '2.000',
      freightCharge: '10.00',
      insuranceCharge: '2.00',
      otherCharges: '0.00',
    }), context()), 201)
    expect(shipment.status).toBe('DRAFT')

    const invoice = await data<{ id: string }>(await createInvoice(request('/api/invoices', 'POST', {
      shipmentId: shipment.id,
      supplierId: supplier.id,
      invoiceNumber: `INV-${marker}`,
      invoiceDate: new Date().toISOString(),
      currency: 'BSD',
      exchangeRate: '1',
      incotermCode: 'FOB',
      incotermLocation: 'Miami',
      subTotal: '50.00',
    }), context()), 201)

    await data(await createLineItem(request(`/api/invoices/${invoice.id}/line-items`, 'POST', {
      hsCodeId: references.hsCodeId,
      hsCode: '6109.10.00',
      cpcCode: '400',
      description: 'Cotton t-shirts',
      quantity: '2',
      unit: 'PCS',
      unitPrice: '25.0000',
      totalValue: '50.00',
      weightLb: '2.000',
      netWeightLb: '1.800',
      countryOfOrigin: 'US',
      packageCount: 1,
      packageTypeCode: 'CT',
    }), context(invoice.id)), 201)

    const calculation = await data<{ totals: { totalCifValue: string; totalPayable: string } }>(await calculateShipment(
      request(`/api/shipments/${shipment.id}/calculate`, 'POST', { apportionmentBasis: 'VALUE' }),
      context(shipment.id),
    ), 200)
    // FOB 50 + freight 10 + insurance 2 = CIF 62 exactly.
    expect(calculation.totals.totalCifValue).toBe('62.00')
    expect(d(calculation.totals.totalPayable).greaterThan(0)).toBe(true)

    const artifactBatch = await data<{ artifacts: { artifact: { id: string }; downloadUrl: string; validation: { ready: boolean } }[] }>(await generateArtifact(
      request(`/api/shipments/${shipment.id}/artifacts`, 'POST', { declarationType: 'C13' }),
      context(shipment.id),
    ), 201)
    const artifact = artifactBatch.artifacts[0]!
    expect(artifact.validation.ready).toBe(true)

    const xmlResponse = await downloadXml(
      request(artifact.downloadUrl, 'GET'),
      context(artifact.artifact.id),
    )
    expect(xmlResponse.status).toBe(200)
    expect(xmlResponse.headers.get('content-type')).toContain('application/xml')
    const xml = await xmlResponse.text()
    const persistedArtifact = await db.customsEntry.findUniqueOrThrow({
      where: { id: artifact.artifact.id },
      select: { functionalReferenceId: true, totalPayable: true },
    })
    expect(xml).toContain(`<FunctionalReferenceID>${persistedArtifact.functionalReferenceId}</FunctionalReferenceID>`)
    expect(String(persistedArtifact.totalPayable)).toBe(d(calculation.totals.totalPayable).toString())
    expect(xml).toContain('61091000')
    expect(xml).toContain('Cotton t-shirts')

    const persistedShipment = await db.shipment.findUnique({ where: { id: shipment.id }, select: { status: true } })
    expect(persistedShipment?.status).toBe('DRAFT')

    const unrelatedClient = await data<{ id: string }>(await createClient(request('/api/clients', 'POST', {
      name: `E2E Unrelated Importer ${marker}`,
      clientType: 'BUSINESS',
    }), context()), 201)
    const mismatchedBillingResponse = await createBrokerageInvoice(
      request('/api/billing/invoices', 'POST', {
        clientId: unrelatedClient.id,
        invoiceNumber: `BILL-WRONG-${marker}`,
        vatRate: '0.10',
        items: [{ description: 'Wrong client shipment', shipmentId: shipment.id, quantity: '1', unitPrice: '100.00' }],
      }),
      context(),
    )
    expect(mismatchedBillingResponse.status).toBe(422)
    expect((await mismatchedBillingResponse.json()).error.code).toBe('BUSINESS_RULE_VIOLATION')

    const brokerageInvoice = await data<{ id: string; status: string; total: string }>(await createBrokerageInvoice(
      request('/api/billing/invoices', 'POST', {
        clientId: client.id,
        invoiceNumber: `BILL-${marker}`,
        vatRate: '0.10',
        items: [{ description: 'Declaration preparation', shipmentId: shipment.id, quantity: '1', unitPrice: '100.00' }],
      }),
      context(),
    ), 201)
    expect(brokerageInvoice.status).toBe('DRAFT')
    expect(d(brokerageInvoice.total).toFixed(2)).toBe('110.00')

    const sentInvoice = await data<{ status: string }>(await sendBrokerageInvoice(
      request(`/api/billing/invoices/${brokerageInvoice.id}/send`, 'POST'),
      context(brokerageInvoice.id),
    ), 200)
    expect(sentInvoice.status).toBe('SENT')

    const paidInvoice = await data<{ status: string; amountPaid: string }>(await recordBrokeragePayment(
      request(`/api/billing/invoices/${brokerageInvoice.id}/payments`, 'POST', {
        amount: '110.00', method: 'BANK_TRANSFER', reference: `PAY-${marker}`,
      }),
      context(brokerageInvoice.id),
    ), 201)
    expect(paidInvoice.status).toBe('PAID')
    expect(d(paidInvoice.amountPaid).toFixed(2)).toBe('110.00')
  }, 30_000)
})
