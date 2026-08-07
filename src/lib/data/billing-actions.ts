/**
 * SERVER ACTIONS — BROKERAGE BILLING
 * -----------------------------------------------------------------------------
 * Create an invoice or a quote, send a draft, and convert an accepted quote
 * into an invoice. All go through billingService, which owns the money math,
 * status rules, and audit writes. Expected failures travel back as data
 * (Server Actions redact thrown errors), matching lib/data/invoices.ts.
 */
'use server'

import { headers } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { requirePermission } from '@/lib/auth/rbac'
import { createTenantClient } from '@/lib/db/tenant-client'
import { billingService } from '@/server/services/billing.service'
import { brokerageInvoiceCreateSchema, quoteConvertSchema } from '@/lib/validation/schemas'
import { AppError } from '@/lib/errors'

async function ctx() {
  const claims = await requireSession()
  requirePermission(claims.role, 'billing:write')
  const headerList = await headers()
  const db = createTenantClient(claims.orgId)
  const audit = {
    userId: claims.sub,
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerList.get('user-agent') ?? undefined,
  }
  return { db, audit }
}

export interface ActionResult {
  id: string | null
  error: string | null
}

export interface DocDraft {
  kind: 'INVOICE' | 'QUOTE'
  clientId: string
  number: string
  dueDate: string // YYYY-MM-DD or ''
  validUntil: string // YYYY-MM-DD or ''
  vatRate: string // decimal fraction, e.g. "0.10"
  notes: string
  items: { description: string; quantity: string; unitPrice: string }[]
}

export async function createBrokerageDoc(draft: DocDraft): Promise<ActionResult> {
  let db, audit
  try {
    ;({ db, audit } = await ctx())
  } catch (error) {
    if (error instanceof AppError) return { id: null, error: error.message }
    throw error
  }

  let input
  try {
    input = brokerageInvoiceCreateSchema.parse({
      clientId: draft.clientId,
      kind: draft.kind,
      invoiceNumber: draft.number.trim(),
      dueDate: draft.dueDate || undefined,
      validUntil: draft.validUntil || undefined,
      vatRate: draft.vatRate.trim() || '0.10',
      notes: draft.notes.trim() || undefined,
      items: draft.items
        .filter((i) => i.description.trim() !== '' && i.unitPrice.trim() !== '')
        .map((i) => ({
          description: i.description.trim(),
          quantity: i.quantity.trim() || '1',
          unitPrice: i.unitPrice.trim(),
        })),
    })
  } catch {
    return {
      id: null,
      error: 'Check the form: a client, a number, and at least one line item with a price are required.',
    }
  }

  try {
    const doc = await billingService.create(db, audit, input)
    return { id: doc.id, error: null }
  } catch (error) {
    if (error instanceof AppError) return { id: null, error: error.message }
    throw error
  }
}

export async function sendBrokerageDoc(id: string): Promise<ActionResult> {
  try {
    const { db, audit } = await ctx()
    await billingService.send(db, audit, id)
    return { id, error: null }
  } catch (error) {
    if (error instanceof AppError) return { id: null, error: error.message }
    throw error
  }
}

export async function convertQuote(id: string, invoiceNumber: string): Promise<ActionResult> {
  let db, audit
  try {
    ;({ db, audit } = await ctx())
  } catch (error) {
    if (error instanceof AppError) return { id: null, error: error.message }
    throw error
  }

  let input
  try {
    input = quoteConvertSchema.parse({ invoiceNumber: invoiceNumber.trim() })
  } catch {
    return { id: null, error: 'A fresh, unique invoice number is required to convert the quote.' }
  }

  try {
    const inv = await billingService.convertToInvoice(db, audit, id, input)
    return { id: inv.id, error: null }
  } catch (error) {
    if (error instanceof AppError) return { id: null, error: error.message }
    throw error
  }
}
