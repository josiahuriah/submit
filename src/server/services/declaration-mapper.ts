/**
 * Shipment → BeaipDeclaration mapping, shared by the declarations service
 * (submit path) and scripts/generate-wco-declaration.ts (the TFP sample-file
 * gate). One select, one mapper — the wire payload can never drift from what
 * the submit path sends.
 *
 * Placeholders pending government worksheets (labeled here, nowhere else):
 *   - regimeCode "4"  — TTFB_SYS_REGIME withheld; the spec's sample uses 4.
 *   - submitterId     — needs the broker's Company Registration Number; falls
 *     back to Organization.licenseNumber, then tinNumber, then "CRN-PENDING".
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import type { BeaipDeclaration, BeaipInvoice, BeaipParty } from '@/lib/beaip'
import { moneyString, sum } from '@/lib/calculations/money'
import type { DeclarationType } from '@/generated/prisma/enums'

/** PLACEHOLDER: Regime code (wire TypeCode) until TTFB_SYS_REGIME arrives. */
export const REGIME_CODE_PLACEHOLDER = '4'

export const DECLARATION_SOURCE_SELECT = {
  id: true,
  shipmentNumber: true,
  status: true,
  blNumber: true,
  containerNumber: true,
  packageCount: true,
  packageType: true,
  transportMode: true,
  grossWeightKg: true,
  calculatedAt: true,
  updatedAt: true,
  totalCifValue: true,
  totalDuty: true,
  totalVat: true,
  totalLevy: true,
  totalExcise: true,
  processingFee: true,
  totalPayable: true,
  organization: { select: { name: true, tinNumber: true, licenseNumber: true } },
  client: { select: { name: true, tinNumber: true, address: true } },
  declarationOffice: { select: { code: true } },
  manifest: {
    select: {
      manifestNumber: true,
      voyage: {
        select: {
          arrivalDate: true,
          vessel: { select: { name: true } },
          journey: {
            select: {
              originPort: { select: { unLocode: true, country: true } },
              destinationPort: { select: { unLocode: true } },
            },
          },
        },
      },
    },
  },
  invoices: {
    select: {
      invoiceNumber: true,
      invoiceDate: true,
      currency: true,
      subTotal: true,
      supplier: { select: { name: true, country: true, address: true } },
      lineItems: {
        select: {
          lineNumber: true,
          hsCode: true,
          cpcCode: true,
          description: true,
          commercialDescription: true,
          countryOfOrigin: true,
          quantity: true,
          unit: true,
          weightKg: true,
          totalValue: true,
          freightApportioned: true,
          insuranceApportioned: true,
          otherCostApportioned: true,
          cifValue: true,
          dutyAmount: true,
          vatAmount: true,
          levyAmount: true,
          exciseAmount: true,
        },
        orderBy: { lineNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
} as const

export async function loadDeclarationSource(db: TenantClient, shipmentId: string) {
  return db.shipment.findUnique({
    where: { id: shipmentId },
    select: DECLARATION_SOURCE_SELECT,
  })
}

export type DeclarationSource = NonNullable<Awaited<ReturnType<typeof loadDeclarationSource>>>

export function toBeaipDeclaration(
  shipment: DeclarationSource,
  declarationType: DeclarationType,
): BeaipDeclaration {
  const org = shipment.organization
  const voyage = shipment.manifest?.voyage ?? null
  const journey = voyage?.journey ?? null
  const firstSupplierCountry =
    shipment.invoices.map((inv) => inv.supplier.country).find((c) => c != null) ?? null

  const declarant: BeaipParty = {
    name: org.name,
    id: org.tinNumber,
    address: null,
  }
  const importer: BeaipParty = {
    name: shipment.client.name,
    id: shipment.client.tinNumber,
    address: shipment.client.address
      ? { cityName: null, countryCode: null, line: shipment.client.address, postcode: null }
      : null,
  }

  const invoices: BeaipInvoice[] = shipment.invoices.map((inv) => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate?.toISOString() ?? null,
    currency: inv.currency,
    subTotal: moneyString(String(inv.subTotal)),
    supplier: {
      name: inv.supplier.name,
      id: null,
      address: inv.supplier.address
        ? {
            cityName: null,
            countryCode: inv.supplier.country,
            line: inv.supplier.address,
            postcode: null,
          }
        : inv.supplier.country
          ? { cityName: null, countryCode: inv.supplier.country, line: null, postcode: null }
          : null,
    },
    freightApportioned: moneyString(
      sum(inv.lineItems.map((l) => String(l.freightApportioned))),
    ),
    insuranceApportioned: moneyString(
      sum(inv.lineItems.map((l) => String(l.insuranceApportioned))),
    ),
    otherApportioned: moneyString(
      sum(inv.lineItems.map((l) => String(l.otherCostApportioned))),
    ),
  }))

  const lines = shipment.invoices.flatMap((inv) =>
    inv.lineItems.map((l) => ({
      lineNumber: l.lineNumber,
      invoiceNumber: inv.invoiceNumber,
      hsCode: l.hsCode,
      cpcCode: l.cpcCode,
      description: l.description,
      commercialDescription: l.commercialDescription,
      countryOfOrigin: l.countryOfOrigin,
      quantity: String(l.quantity),
      unit: l.unit,
      weightKg: l.weightKg === null ? null : String(l.weightKg),
      totalValue: moneyString(String(l.totalValue)),
      currency: inv.currency,
      freightApportioned: moneyString(String(l.freightApportioned)),
      insuranceApportioned: moneyString(String(l.insuranceApportioned)),
      otherApportioned: moneyString(String(l.otherCostApportioned)),
      cifValue: moneyString(String(l.cifValue)),
      dutyAmount: moneyString(String(l.dutyAmount)),
      vatAmount: moneyString(String(l.vatAmount)),
      levyAmount: moneyString(String(l.levyAmount)),
      exciseAmount: moneyString(String(l.exciseAmount)),
    })),
  )

  return {
    declarationType,
    regimeCode: REGIME_CODE_PLACEHOLDER,
    functionalReferenceId: shipment.shipmentNumber,
    brokerReference: shipment.shipmentNumber,
    customsOfficeCode: shipment.declarationOffice.code,
    submitterId: org.licenseNumber ?? org.tinNumber ?? 'CRN-PENDING',
    declarant,
    importer,
    consignee: importer,
    blNumber: shipment.blNumber,
    packageCount: shipment.packageCount,
    packageUom: shipment.packageType,
    grossWeightKg: shipment.grossWeightKg === null ? null : String(shipment.grossWeightKg),
    transport: {
      vesselName: voyage?.vessel.name ?? null,
      transportMode: shipment.transportMode,
      arrivalDate: voyage?.arrivalDate?.toISOString() ?? null,
      containerNumber: shipment.containerNumber,
      manifestNumber: shipment.manifest?.manifestNumber ?? null,
      unloadingPortCode: journey?.destinationPort.unLocode ?? null,
      entryPortCode: journey?.destinationPort.unLocode ?? null,
      exitPortCode: journey?.originPort.unLocode ?? null,
      exportCountryCode: journey?.originPort.country ?? firstSupplierCountry,
    },
    invoices,
    totalCifValue: moneyString(String(shipment.totalCifValue)),
    totalDuty: moneyString(String(shipment.totalDuty)),
    totalVat: moneyString(String(shipment.totalVat)),
    totalLevy: moneyString(String(shipment.totalLevy)),
    totalExcise: moneyString(String(shipment.totalExcise)),
    processingFee: moneyString(String(shipment.processingFee)),
    totalPayable: moneyString(String(shipment.totalPayable)),
    lines,
  }
}
