/**
 * DATA-ACCESS SEAM — SUPPLIER INVOICES
 * -----------------------------------------------------------------------------
 * Reads + one Server Action (addInvoice) for attaching a supplier's commercial
 * invoice to a shipment — the step between creating a shipment and entering
 * lines (commitLineItem refuses until an invoice exists).
 */
'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { catalogService } from '@/server/services/catalog.service'
import { invoicesService } from '@/server/services/invoices.service'
import { invoiceCreateSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'
import { revalidatePath } from 'next/cache'
import type { InvoiceSummary } from '@/lib/types'

export interface SupplierOption {
  id: string
  label: string
}

export async function listSupplierOptions(): Promise<SupplierOption[]> {
  const claims = await requireSession()
  const db = createTenantClient(claims.orgId)
  const page = await catalogService.listSuppliers(db, {})
  return page.items.filter((s) => s.isActive).map((s) => ({
    id: s.id,
    label: s.country ? `${s.name} (${s.country})` : s.name,
  }))
}

export interface AddInvoiceResult {
  invoiceId: string | null
  /** Persisted invoice DTO for immediate client-side selection. */
  invoice: InvoiceSummary | null
  /** Expected failures travel as data — Server Actions redact thrown errors. */
  error: string | null
}

export async function addInvoice(
  shipmentId: string,
  draft: {
    supplierId: string
    invoiceNumber: string
    invoiceDate: string // YYYY-MM-DD
    subTotal: string
    currency: string
    exchangeRate: string
    incotermCode: string
    incotermLocation: string
  },
): Promise<AddInvoiceResult> {
  const claims = await requireSession()
  requirePermission(claims.role, 'shipments:write')
  const headerList = await headers()
  const db = createTenantClient(claims.orgId)
  const audit = {
    userId: claims.sub,
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerList.get('user-agent') ?? undefined,
  }

  let input
  try {
    input = invoiceCreateSchema.parse({
      shipmentId,
      supplierId: draft.supplierId,
      invoiceNumber: draft.invoiceNumber.trim(),
      invoiceDate: draft.invoiceDate,
      currency: draft.currency.trim().toUpperCase() || 'BSD',
      exchangeRate: draft.exchangeRate.trim() || '1',
      incotermCode: draft.incotermCode.trim() || undefined,
      incotermLocation: draft.incotermLocation.trim() || undefined,
      subTotal: draft.subTotal.trim() || undefined,
    })
  } catch {
    return { invoiceId: null, invoice: null, error: 'Check the form: supplier, invoice number and date are required.' }
  }

  try {
    const invoice = await invoicesService.createInvoice(db, audit, input)
    const result: InvoiceSummary = {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
      supplierName: invoice.supplier.name,
      subTotal: String(invoice.subTotal),
      currency: invoice.currency,
      exchangeRate: String(invoice.exchangeRate),
      incotermCode: invoice.incotermCode,
      incotermLocation: invoice.incotermLocation,
    }
    revalidatePath(`/shipments/${shipmentId}/entry`)
    return { invoiceId: invoice.id, invoice: result, error: null }
  } catch (error) {
    if (error instanceof AppError) return { invoiceId: null, invoice: null, error: error.message }
    throw error
  }
}
