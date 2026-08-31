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
import { normalizeHsCode } from '@/lib/customs/normalization'

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
  city: z.string().max(100).optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  postcode: z.string().max(20).optional(),
  contactPerson: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
})
export const clientUpdateSchema = clientCreateSchema.partial().extend({
  tinNumber: z.string().max(30).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  countryCode: z.string().length(2).toUpperCase().nullable().optional(),
  postcode: z.string().max(20).nullable().optional(),
  contactPerson: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
})

export const supplierCreateSchema = z.object({
  name: z.string().min(1).max(160),
  country: z.string().length(2, 'ISO alpha-2 country code').toUpperCase().optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(400).optional(),
  city: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
})
export const supplierUpdateSchema = supplierCreateSchema.partial().extend({
  country: z.string().length(2, 'ISO alpha-2 country code').toUpperCase().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  postcode: z.string().max(20).nullable().optional(),
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
  shippingAgentId: id.nullable().optional(),
  registeredAt: z.coerce.date().nullable().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
})

export const shippingAgentCreateSchema = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(30).toUpperCase().optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
})

export const vesselCreateSchema = z.object({
  carrierId: id,
  name: z.string().min(1).max(160),
  mode: z.enum(['SEA', 'AIR']),
  // Aircraft do not have IMO numbers. The action strips this field for AIR.
  imoNumber: z.string().min(1).max(30).toUpperCase().optional(),
})

export const journeyCreateSchema = z.object({
  originPortId: id,
  destinationPortId: id,
}).refine(
  ({ originPortId, destinationPortId }) => originPortId !== destinationPortId,
  { message: 'Origin and destination ports must be different', path: ['destinationPortId'] },
)

export const voyageCreateSchema = z.object({
  vesselId: id,
  journeyId: id.optional(),
  voyageNumber: z.string().min(1).max(60),
  departureDate: z.coerce.date().optional(),
  arrivalDate: z.coerce.date().optional(),
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
  transportMode: z.enum(['SEA', 'AIR']).default('SEA'),
  blNumber: z.string().max(60).optional(),
  containerNumber: z.string().max(20).optional(),
  containerSealNumber: z.string().max(35).optional(),
  containerFullnessCode: z.string().max(10).optional(),
  declarationDate: z.coerce.date().optional(),
  declarationFunctionCode: z.literal('9').default('9'),
  regimeCode: z.string().min(1).max(17).default('4'),
  isSplitDeclaration: z.boolean().default(false),
  goodsLocationCode: z.string().max(35).optional(),
  warehouseCode: z.string().max(35).optional(),
  transportNationalityCode: z.string().length(2).toUpperCase().optional(),
  description: z.string().max(1000).optional(),
  grossWeightLb: quantity.optional(),
  netWeightLb: quantity.optional(),
  freightCharge: moneyOptional,
  insuranceCharge: moneyOptional,
  otherCharges: moneyOptional,
})
export const shipmentUpdateSchema = shipmentCreateSchema.partial().extend({
  manifestId: id.nullable().optional(),
  grossWeightLb: quantity.nullable().optional(),
  netWeightLb: quantity.nullable().optional(),
})

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
  exchangeRate: z.literal('1').default('1'),
  incotermCode: z.string().max(10).toUpperCase().optional(),
  incotermLocation: z.string().max(100).optional(),
  subTotal: moneyOptional,
})
export const invoiceUpdateSchema = invoiceCreateSchema.partial().omit({ shipmentId: true })

export const lineItemCreateSchema = z.object({
  invoiceId: id,
  hsCodeId: id.optional(),
  hsCode: z.preprocess(
    (value) => typeof value === 'string' ? normalizeHsCode(value) : value,
    z.string().regex(/^\d{8}$/, 'Use the full 8-digit tariff code'),
  ),
  // Customs Procedure Code, e.g. "400". Shape-checked only: no authoritative
  // CPC list is encoded, so an unknown-but-well-formed code is accepted and
  // surfaces during Customs review rather than being rejected at entry.
  cpcCode: z.enum(['400', '4098']).default('400'),
  description: z.string().min(1).max(500),
  commercialDescription: z.string().max(200).optional(),
  pageNumber: z.coerce.number().int().positive().optional(),
  quantity: quantity,
  unit: z.string().max(20).default('PCS'),
  unitPrice: z.string().regex(/^\d{1,13}(\.\d{1,4})?$/, 'Invalid unit price'),
  totalValue: money,
  weightLb: quantity.optional(),
  netWeightLb: quantity.optional(),
  countryOfOrigin: z.string().length(2).toUpperCase().optional(),
  packageCount: z.coerce.number().int().positive().optional(),
  packageTypeCode: z.string().max(10).optional(),
  unitsPerPackage: z.coerce.number().int().positive().optional(),
  unitVolume: quantity.optional(),
  volumeUnit: z.enum(['ML', 'CL', 'L', 'US_FL_OZ', 'IMP_FL_OZ', 'IMP_GAL']).optional(),
  alcoholStrength: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3})?$/, 'Invalid alcohol strength')
    .optional(),
  alcoholStrengthBasis: z.enum(['ABV_PERCENT', 'US_PROOF']).optional(),
  exemptionType: z.enum(['NONE', 'FULL', 'PARTIAL', 'CONDITIONAL']).default('NONE'),
  exemptionRef: z.string().max(60).optional(),
})
export const lineItemUpdateSchema = lineItemCreateSchema.partial().omit({ invoiceId: true })

// --- calculation / review artifact ------------------------------------------------------------

export const calculateOptionsSchema = z.object({
  apportionmentBasis: z.enum(['VALUE', 'WEIGHT']).default('VALUE'),
})

export const declarationArtifactSchema = z.object({
  declarationType: z.enum(['C13', 'C14', 'C17', 'C18', 'OTHER']).default('C13'),
}).strict()

export const customsSubmissionSchema = z.object({
  confirmResubmission: z.boolean().default(false),
  resubmissionReason: z.string().trim().min(3).max(500).optional(),
}).strict()

// --- billing --------------------------------------------------------------------------------

export const brokerageInvoiceCreateSchema = z.object({
  clientId: id,
  invoiceNumber: z.string().min(1).max(60),
  dueDate: z.coerce.date().optional(),
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
