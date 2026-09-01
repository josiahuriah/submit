/**
 * Shipment → BeaipDeclaration mapping shared by the review-artifact service
 * and the TFP generator script. One select, one mapper keeps CLI and UI XML
 * generation aligned.
 *
 * Placeholders pending government worksheets (labeled here, nowhere else):
 *   - regimeCode "4" remains the schema default pending TTFB_SYS_REGIME.
 *   - Submitter ID comes from the server-only BEAIP broker code for live QA;
 *     the organization field remains an offline-review fallback.
 *   - Declaration function is fixed by the current filing workflow.
 */
import type { TenantClient } from '@/lib/db/tenant-client'
import type { BeaipDeclaration, BeaipInvoice, BeaipParty } from '@/lib/beaip'
import { apportion } from '@/lib/calculations/apportionment'
import { d, moneyString, sum } from '@/lib/calculations/money'
import type { DeclarationType } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'
import {
  ORIGINAL_DECLARATION_FUNCTION_CODE,
  resolveBeaipBrokerCode,
  TFP_DECLARANT_NAME,
  TFP_DECLARATION_OFFICE_CODE,
} from '@/lib/beaip/constants'
import {
  buildFunctionalReferenceId,
  buildTraderAssignedReferenceId,
  buildSubmissionReferences,
} from '@/lib/beaip/references'

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
  grossWeightLb: true,
  netWeightLb: true,
  declarationDate: true,
  submittedAt: true,
  declarationFunctionCode: true,
  regimeCode: true,
  isSplitDeclaration: true,
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
    select: { id: true, name: true, tinNumber: true, companyRegistrationNumber: true },
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
          weightLb: true,
          netWeightLb: true,
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
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ShipmentSelect

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
  configuredBrokerCode = '',
): BeaipDeclaration {
  const org = shipment.organization
  const declarationDate = (shipment.submittedAt ?? shipment.declarationDate).toISOString()
  const voyage = shipment.manifest?.voyage ?? null
  const journey = voyage?.journey ?? null
  const firstSupplierCountry =
    shipment.invoices.map((inv) => inv.supplier.country).find((c) => c != null) ?? null

  const declarant: BeaipParty = {
    name: TFP_DECLARANT_NAME,
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
      weightLb: l.weightLb === null ? null : String(l.weightLb),
      netWeightLb: l.netWeightLb === null ? null : String(l.netWeightLb),
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
    isSplitDeclaration: shipment.isSplitDeclaration,
    declarationGroupCode: '400',
    declarationSequence: 1,
    declarationType,
    regimeCode: shipment.regimeCode,
    functionCode: ORIGINAL_DECLARATION_FUNCTION_CODE,
    declarationDate,
    functionalReferenceId: buildFunctionalReferenceId(declarationDate, shipment.shipmentNumber),
    brokerReference: buildTraderAssignedReferenceId(declarationDate, shipment.shipmentNumber),
    customsOfficeCode: TFP_DECLARATION_OFFICE_CODE,
    submitterId: resolveBeaipBrokerCode(
      configuredBrokerCode,
      shipment.organization.companyRegistrationNumber,
    ),
    declarant,
    importer,
    consignee: importer,
    blNumber: shipment.blNumber,
    packageCount: shipment.packageCount,
    packageUom: shipment.packageType,
    grossWeightLb: shipment.grossWeightLb === null ? null : String(shipment.grossWeightLb),
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

/** Build one wire declaration per CPC when the broker selected split filing. */
export function partitionBeaipDeclaration(
  declaration: BeaipDeclaration,
  referenceSeed: string,
): BeaipDeclaration[] {
  const cpcs = [...new Set(declaration.lines.map((line) => line.cpcCode))].sort()
  if (!declaration.isSplitDeclaration && cpcs.length > 1) {
    throw new Error('Mixed CPC lines require the split declaration option')
  }
  const groups = declaration.isSplitDeclaration ? cpcs : [cpcs[0] ?? '400']
  const groupedLines = groups.map((cpc) => (
    declaration.isSplitDeclaration
      ? declaration.lines.filter((line) => line.cpcCode === cpc)
      : declaration.lines
  ))
  const processingFees = new Map(apportion(
    declaration.processingFee,
    groupedLines.map((lines, index) => ({
      id: String(index),
      totalValue: sum(lines.map((line) => line.cifValue)),
    })),
  ).map((share) => [Number(share.id), share.amount]))

  // Fee VAT is stored only on the shipment. Preserve that frozen residual
  // instead of dropping it when rebuilding totals from individual lines.
  const vatOnFee = d(declaration.totalVat).minus(sum(declaration.lines.map((line) => line.vatAmount)))
  if (vatOnFee.isNegative()) throw new Error('Shipment VAT is lower than its line VAT total; recalculate before generating XML')
  const feeVatShares = new Map(apportion(
    vatOnFee,
    groupedLines.map((_lines, index) => ({
      id: String(index),
      totalValue: processingFees.get(index) ?? d(0),
    })),
  ).map((share) => [Number(share.id), share.amount]))

  return groups.map((cpc, index) => {
    const sourceLines = groupedLines[index] ?? []
    const invoiceNumbers = new Set(sourceLines.map((line) => line.invoiceNumber))
    const invoices = declaration.invoices
      .filter((invoice) => invoiceNumbers.has(invoice.invoiceNumber))
      .map((invoice) => {
        const invoiceLines = sourceLines.filter((line) => line.invoiceNumber === invoice.invoiceNumber)
        return {
          ...invoice,
          currency: 'BSD',
          exchangeRate: '1',
          subTotal: moneyString(sum(invoiceLines.map((line) => line.totalValue))),
          freightApportioned: moneyString(sum(invoiceLines.map((line) => line.freightApportioned))),
          insuranceApportioned: '0.00',
          otherApportioned: moneyString(sum(invoiceLines.map((line) => line.otherApportioned))),
        }
      })
    const references = buildSubmissionReferences(
      declaration.declarationDate,
      `${referenceSeed}:${index + 1}:${cpc}`,
    )
    const totalDuty = sum(sourceLines.map((line) => line.dutyAmount))
    const totalVat = sum(sourceLines.map((line) => line.vatAmount)).plus(feeVatShares.get(index) ?? d(0))
    const totalLevy = sum(sourceLines.map((line) => line.levyAmount))
    const totalExcise = sum(sourceLines.map((line) => line.exciseAmount))
    const processingFee = processingFees.get(index) ?? d(0)

    return {
      ...declaration,
      ...references,
      declarationGroupCode: cpc,
      declarationSequence: index + 1,
      packageCount: declaration.isSplitDeclaration
        ? sourceLines.reduce((total, line) => total + (line.packageCount ?? 0), 0)
        : declaration.packageCount,
      grossWeightLb: declaration.isSplitDeclaration
        ? sum(sourceLines.map((line) => d(line.weightLb))).toDecimalPlaces(3).toFixed(3)
        : declaration.grossWeightLb,
      invoices,
      lines: sourceLines.map((line, lineIndex) => ({
        ...line,
        lineNumber: lineIndex + 1,
        currency: 'BSD',
        insuranceApportioned: '0.00',
      })),
      totalCifValue: moneyString(sum(sourceLines.map((line) => line.cifValue))),
      totalDuty: moneyString(totalDuty),
      totalVat: moneyString(totalVat),
      totalLevy: moneyString(totalLevy),
      totalExcise: moneyString(totalExcise),
      processingFee: moneyString(processingFee),
      totalPayable: moneyString(sum([
        totalDuty,
        totalVat,
        totalLevy,
        totalExcise,
        processingFee,
      ])),
    }
  })
}
