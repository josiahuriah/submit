/**
 * API input validation (Zod) — the single source of truth for what the API
 * accepts. Services receive `z.infer<>` types, so a schema change propagates
 * through the type system.
 *
 * Conventions:
 *  - Money arrives as strings ("123.45") — never floats — validated against
 *    MONEY_REGEX and handled as Decimal internally.
 *  - Field names mirror prisma/schema.prisma exactly.
 */
import { z } from 'zod'

// --- shared primitives -------------------------------------------------------

const MONEY_REGEX = /^\d{1,13}(\.\d{1,2})?$/
export const money = z
  .string()
  .regex(MONEY_REGEX, 'Must be a positive amount with up to 2 decimal places')
export const moneyOptional = money.optional().default('0')

const QTY_REGEX = /^\d{1,13}(\.\d{1,4})?$/
export const quantity = z.string().regex(QTY_REGEX, 'Must be a positive quantity')

const RATE_REGEX = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/ // 0–1 as fraction

export const id = z.string().min(1)

export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

// --- auth ----------------------------------------------------------------------

export const registerSchema = z.object({
  organizationName: z.string().min(2).max(120),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email().toLowerCase(),
  password: z.string().min(10, 'Password must be at least 10 characters').max(128),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
})
export type LoginInput = z.infer<typeof loginSchema>

// --- clients / suppliers ----------------------------------------------------------

export const clientCreateSchema = z.object({
  name: z.string().min(1).max(160),
  clientType: z.enum(['BUSINESS', 'INDIVIDUAL']).default('BUSINESS'),
  tinNumber: z.string().max(30).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(400).optional(),
  contactPerson: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
})
export const clientUpdateSchema = clientCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
})

export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(160),
  country: z.string().length(2, 'ISO alpha-2 country code').toUpperCase().optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(400).optional(),
})
export const supplierUpdateSchema = supplierCreateSchema.partial().extend({
  isActive: z.boolean().optional(),
})

// --- manifests ----------------------------------------------------------------------

export const manifestCreateSchema = z.object({
  manifestNumber: z.string().min(1).max(60),
  voyageId: id,
  shippingAgentId: id.optional(),
  registeredAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
})
export const manifestUpdateSchema = manifestCreateSchema.partial().extend({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
})

// --- shipments -------------------------------------------------------------------------

export const shipmentCreateSchema = z.object({
  shipmentNumber: z.string().min(1).max(60),
  clientId: id,
  manifestId: id.optional(),
  declarationOfficeId: id,
  goodsType: z.enum(['GENERAL', 'PERSONAL_EFFECTS', 'COMMERCIAL', 'VEHICLE', 'HAZARDOUS', 'PERISHABLE']).default('GENERAL'),
  packageType: z
    .enum(['CONTAINER', 'PALLET', 'CARTON', 'CRATE', 'DRUM', 'BUNDLE', 'LOOSE', 'VEHICLE', 'OTHER'])
    .default('CARTON'),
  packageCount: z.coerce.number().int().positive().default(1),
  transportMode: z.enum(['SEA', 'AIR', 'LAND']).default('SEA'),
  blNumber: z.string().max(60).optional(),
  containerNumber: z.string().max(20).optional(),
  description: z.string().max(1000).optional(),
  grossWeightKg: quantity.optional(),
  freightCharge: moneyOptional,
  insuranceCharge: moneyOptional,
  otherCharges: moneyOptional,
})
export const shipmentUpdateSchema = shipmentCreateSchema.partial()

export const shipmentStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'CLEARED', 'CANCELLED'])

export const shipmentListQuery = paginationQuery.extend({
  status: shipmentStatusSchema.optional(),
  clientId: id.optional(),
  search: z.string().max(120).optional(),
})

// --- invoices / line items ----------------------------------------------------------------

export const invoiceCreateSchema = z.object({
  shipmentId: id,
  supplierId: id,
  invoiceNumber: z.string().min(1).max(60),
  invoiceDate: z.coerce.date(),
  currency: z.literal('BSD').default('BSD'),
  subTotal: moneyOptional,
})
export const invoiceUpdateSchema = invoiceCreateSchema.partial().omit({ shipmentId: true })

export const lineItemCreateSchema = z.object({
  invoiceId: id,
  hsCodeId: id.optional(),
  hsCode: z.string().min(4).max(15), // denormalized code string, e.g. "2208.40.10"
  // Customs Procedure Code, e.g. "4000". Shape-checked only: no authoritative
  // CPC list is encoded, so an unknown-but-well-formed code is accepted and
  // surfaces at submission rather than being rejected at entry.
  cpcCode: z.string().regex(/^[0-9A-Z-]{3,10}$/, 'Invalid CPC code').default('4000'),
  description: z.string().min(1).max(500),
  commercialDescription: z.string().max(200).optional(),
  pageNumber: z.coerce.number().int().positive().optional(),
  quantity: quantity,
  unit: z.string().max(20).default('PCS'),
  unitPrice: z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Invalid unit price'),
  totalValue: money,
  weightKg: quantity.optional(),
  countryOfOrigin: z.string().length(2).toUpperCase().optional(),
  exemptionType: z.enum(['NONE', 'FULL', 'PARTIAL', 'CONDITIONAL']).default('NONE'),
  exemptionRef: z.string().max(60).optional(),
})
export const lineItemUpdateSchema = lineItemCreateSchema.partial().omit({ invoiceId: true })

// --- calculation / submission ----------------------------------------------------------------

export const calculateOptionsSchema = z.object({
  apportionmentBasis: z.enum(['VALUE', 'WEIGHT']).default('VALUE'),
})

export const submitDeclarationSchema = z.object({
  declarationType: z.enum(['C13', 'C14', 'C17', 'C18', 'OTHER']).default('C13'),
})

// --- billing --------------------------------------------------------------------------------

export const brokerageInvoiceCreateSchema = z.object({
  clientId: id,
  // INVOICE (default) bills the client; QUOTE produces a non-binding proforma
  // estimate using the same math. Quotes never accrue payments.
  kind: z.enum(['INVOICE', 'QUOTE']).default('INVOICE'),
  invoiceNumber: z.string().min(1).max(60),
  dueDate: z.coerce.date().optional(),
  // Quotes only: date after which the estimate lapses.
  validUntil: z.coerce.date().optional(),
  vatRate: z.string().regex(RATE_REGEX).default('0.10'),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(300),
        shipmentId: id.optional(),
        quantity: quantity.default('1'),
        unitPrice: money,
      }),
    )
    .min(1),
})

// Convert an accepted QUOTE into a billable INVOICE. A fresh invoice number is
// required because quote and invoice numbers share the same per-org sequence.
export const quoteConvertSchema = z.object({
  invoiceNumber: z.string().min(1).max(60),
  dueDate: z.coerce.date().optional(),
})

export const paymentCreateSchema = z.object({
  brokerageInvoiceId: id,
  amount: money,
  method: z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'CARD', 'OTHER']).default('BANK_TRANSFER'),
  reference: z.string().max(120).optional(),
  receivedAt: z.coerce.date().optional(),
})

// --- HS code search ----------------------------------------------------------------------------

export const hsCodeSearchQuery = z.object({
  q: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})
