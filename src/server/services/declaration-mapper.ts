/**
 * Shipment → BeaipDeclaration mapping shared by the review-artifact service
 * and the TFP generator script. One select, one mapper keeps CLI and UI XML
 * generation aligned.
 *
 * Placeholders pending government worksheets (labeled here, nowhere else):
 *   - regimeCode "4" remains the schema default pending TTFB_SYS_REGIME.
 *   - Submitter ID and declaration function are fixed by the current filing
 *     workflow and cannot be overridden per entry.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import type { BeaipDeclaration, BeaipInvoice, BeaipParty } from '@/lib/beaip'
import { moneyString, sum } from '@/lib/calculations/money'
import type { DeclarationType } from '@/generated/prisma/enums'
import { ORIGINAL_DECLARATION_FUNCTION_CODE, TFP_COMPANY_REGISTRATION_NUMBER } from '@/lib/beaip/constants'

/** PLACEHOLDER: Regime code (wire TypeCode) until TTFB_SYS_REGIME arrives. */
export const DECLARATION_SOURCE_SELECT = {
  id: true,
  shipmentNumber: true,
  status: true,
  blNumber: true,
  containerNumber: true,
  containerSealNumber: true,
  containerFullnessCode: true,
  packageCount: true,
  packageType: true,
  transportMode: true,
  grossWeightKg: true,
  netWeightKg: true,
  declarationDate: true,
  submittedAt: true,
  declarationFunctionCode: true,
  regimeCode: true,
  goodsLocationCode: true,
  warehouseCode: true,
  transportNationalityCode: true,
  calculatedAt: true,
  updatedAt: true,
  totalCifValue: true,
  totalDuty: true,
  totalVat: true,
  totalLevy: true,
  totalExcise: true,
  processingFee: true,
  totalPayable: true,
  organization: {
    select: { name: true, tinNumber: true, companyRegistrationNumber: true },
  },
  client: {
    select: {
      name: true,
      tinNumber: true,
      address: true,
      city: true,
      countryCode: true,
      postcode: true,
    },
  },
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
      exchangeRate: true,
      incotermCode: true,
      incotermLocation: true,
      subTotal: true,
      supplier: {
        select: { name: true, country: true, address: true, city: true, postcode: true },
      },
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
          netWeightKg: true,
          packageCount: true,
          packageTypeCode: true,
          totalValue: true,
          freightApportioned: true,
          insuranceApportioned: true,
          otherCostApportioned: true,
          cifValue: true,
          dutyAmount: true,
          vatAmount: true,
          levyAmount: true,
          exciseAmount: true,
          dutyAssessmentQuantity: true,
          specificRateUnit: true,
          exciseAssessmentQuantity: true,
          exciseSpecificRateUnit: true,
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
      || shipment.client.city
      || shipment.client.countryCode
      || shipment.client.postcode
      ? {
          cityName: shipment.client.city,
          countryCode: shipment.client.countryCode,
          line: shipment.client.address,
          postcode: shipment.client.postcode,
        }
      : null,
  }

  const invoices: BeaipInvoice[] = shipment.invoices.map((inv) => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate?.toISOString() ?? null,
    currency: inv.currency,
    exchangeRate: String(inv.exchangeRate),
    incotermCode: inv.incotermCode,
    incotermLocation: inv.incotermLocation,
    subTotal: moneyString(String(inv.subTotal)),
    supplier: {
      name: inv.supplier.name,
      id: null,
      address: inv.supplier.address || inv.supplier.city || inv.supplier.country || inv.supplier.postcode
        ? {
            cityName: inv.supplier.city,
            countryCode: inv.supplier.country,
            line: inv.supplier.address,
            postcode: inv.supplier.postcode,
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
      netWeightKg: l.netWeightKg === null ? null : String(l.netWeightKg),
      packageCount: l.packageCount,
      packageTypeCode: l.packageTypeCode,
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
      dutyAssessmentQuantity:
        l.dutyAssessmentQuantity === null ? null : String(l.dutyAssessmentQuantity),
      dutyAssessmentUnit: l.specificRateUnit,
      exciseAssessmentQuantity:
        l.exciseAssessmentQuantity === null ? null : String(l.exciseAssessmentQuantity),
      exciseAssessmentUnit: l.exciseSpecificRateUnit,
    })),
  )

  return {
    declarationType,
    regimeCode: shipment.regimeCode,
    functionCode: ORIGINAL_DECLARATION_FUNCTION_CODE,
    declarationDate: (shipment.submittedAt ?? shipment.declarationDate).toISOString(),
    functionalReferenceId: shipment.shipmentNumber,
    brokerReference: shipment.shipmentNumber,
    customsOfficeCode: shipment.declarationOffice.code,
    submitterId: TFP_COMPANY_REGISTRATION_NUMBER,
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
      containerSealNumber: shipment.containerSealNumber,
      containerFullnessCode: shipment.containerFullnessCode,
      manifestNumber: shipment.manifest?.manifestNumber ?? null,
      unloadingPortCode: journey?.destinationPort.unLocode ?? null,
      entryPortCode: journey?.destinationPort.unLocode ?? null,
      exitPortCode: journey?.originPort.unLocode ?? null,
      exportCountryCode: journey?.originPort.country ?? firstSupplierCountry,
      transportNationalityCode: shipment.transportNationalityCode,
      goodsLocationCode: shipment.goodsLocationCode,
      warehouseCode: shipment.warehouseCode,
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
