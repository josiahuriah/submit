/**
 * Frontend domain types (DTOs).
 *
 * These are the SHAPES the UI consumes. They deliberately mirror the Prisma
 * models but live separately, so components never import the Prisma client or
 * its generated types directly. Your data-access layer (lib/data/*) is
 * responsible for mapping repo output → these types. When a repo field name
 * differs, you fix it in ONE place (the mapper), not across the UI.
 *
 * The enum unions below must stay in sync with the Prisma enums.
 */

export type ShipmentStatus = "DRAFT" | "SUBMITTED" | "CLEARED" | "CANCELLED";

export type ChipKind = "draft" | "acc" | "pos" | "neg" | "gold" | "excise";

/** Row shape for the Shipments list page. */
export interface ShipmentListItem {
  id: string;
  shipmentNumber: string;
  blNumber: string;
  manifestNumber: string;
  arrival: string; // ISO date string
  consigneeName: string;
  supplier: string;
  description: string;
  preparedBy: string;
  status: ShipmentStatus;
}

/** Minimal shipment shape for the entry page header. */
export interface ShipmentHeader {
  id: string;
  shipmentNumber: string;
  blNumber: string;
  consigneeName: string;
  status: ShipmentStatus;
  /** Roll-up charges from the engine. Null until the shipment is calculated. */
  totals: ShipmentTotals | null;
  /** Shipment-level charges apportioned across lines. Money as strings. */
  freightCharge: string;
  insuranceCharge: string;
  /** The first supplier invoice on the shipment, if one exists yet. */
  invoice: InvoiceSummary | null;
  invoices: InvoiceSummary[];
  customsArtifacts: CustomsArtifactSummary[];
}

export interface CustomsArtifactSummary {
  id: string;
  groupCode: string;
  downloadUrl: string;
  fileName: string;
  attemptCount: number;
  latestOutcome: string | null;
}

/** Header summary of a supplier's commercial invoice. */
export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplierName: string;
  subTotal: string;
  currency: string;
  exchangeRate: string;
  incotermCode: string | null;
  incotermLocation: string | null;
}

/**
 * Shipment-level roll-ups, straight from the calculation engine. Money as
 * strings for precision.
 *
 * These — never a sum of line amounts — are what the charges ledger shows. The
 * processing fee is charged at shipment level and VAT applies to the fee
 * itself, so `vat` here legitimately exceeds the sum of every line's VAT.
 * Adding up lines silently under-reports the total payable.
 */
export interface ShipmentTotals {
  cif: string;
  duty: string;
  excise: string;
  levy: string;
  vat: string;
  processingFee: string;
  payable: string;
}

/** A single line item as the UI holds it. */
export interface LineItem {
  id: string;
  hsCode: string;
  quantity: number;
  unit: string;
  description: string;
  cpcCode: string;
  unitPrice: number;
  totalValue: string;
  invoiceId: string;
  invoiceNumber: string;
  pageNumber: number | null;
  /** HS code description, for the sub-label under the code. */
  hsDescription?: string;
  /**
   * The AUTHORITATIVE charges, computed by the server's calculation engine and
   * carried as strings so decimal precision survives the trip. Null until the
   * shipment has been calculated — a line is created first and priced after,
   * so a freshly committed line has no numbers yet. Never compute these on the
   * client for a committed line; lib/calc.ts is a pre-commit preview only.
   */
  charges: ServerLineCharges | null;
  /** Rates as applied, frozen at calculation time. Fractions, e.g. "0.4500". */
  rates?: { duty: string; vat: string };
}

/** Server-calculated line charges. Money as strings — see LineItem.charges. */
export interface ServerLineCharges {
  fob: string;
  cif: string;
  duty: string;
  excise: string;
  levy: string;
  vat: string;
  payable: string;
}

/** The subset of a line item the entry row edits before commit. */
export interface LineDraft {
  invoiceId: string;
  hsCode: string;
  quantity: string; // string while editing; coerced on commit
  unit: string;
  description: string;
  cpcCode: string;
  unitPrice: string;
  countryOfOrigin: string;
  weightLb: string;
  netWeightLb: string;
  packageCount: string;
  packageTypeCode: string;
  unitsPerPackage: string;
  unitVolume: string;
  volumeUnit: "ML" | "CL" | "L" | "US_FL_OZ" | "IMP_FL_OZ" | "IMP_GAL";
  alcoholStrength: string;
  alcoholStrengthBasis: "ABV_PERCENT" | "US_PROOF";
}

export interface DeclarationProfile {
  companyRegistrationNumber: string;
  declarationDate: string;
  declarationFunctionCode: "9";
  regimeCode: string;
  goodsLocationCode: string;
  warehouseCode: string;
  transportNationalityCode: string;
  transportMode: "SEA" | "AIR";
  blNumber: string;
  containerNumber: string;
  containerSealNumber: string;
  containerFullnessCode: string;
  packageCount: string;
  packageType: "CONTAINER" | "PALLET" | "CARTON" | "CRATE" | "DRUM" | "BUNDLE" | "LOOSE" | "VEHICLE" | "OTHER";
  grossWeightLb: string;
  netWeightLb: string;
}

/** An HS code with the rates the preview calculator needs. */
export interface HsRate {
  code: string;
  description: string;
  unit: string | null;
  dutyBasis: "AD_VALOREM" | "SPECIFIC" | "COMPOUND" | "ADDITIVE";
  duty: string; // fraction, e.g. "0.4500"
  specificRate: string | null;
  specificRateUnit: string | null;
  vat: string;
  levy: string;
  exciseBasis: "NONE" | "AD_VALOREM" | "SPECIFIC" | "COMPOUND" | "ADDITIVE";
  excise: string;
  exciseSpecificRate: string | null;
  exciseSpecificRateUnit: string | null;
  sourceName: string | null;
  sourcePage: string | null;
  isVerified: boolean;
}

/** Result of the client-side duty preview for one line. */
export interface LineCharges {
  fob: number;
  duty: number;
  excise: number;
  levy: number;
  vat: number;
  payable: number;
}

/** Standard cursor-paginated result from the data layer. */
export interface Page<T> {
  rows: T[];
  nextCursor: string | null;
}
