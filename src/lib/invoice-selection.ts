import type { InvoiceSummary } from '@/lib/types'

/**
 * Pick the invoice that line entry should target after its available invoices
 * change. A just-created invoice wins; otherwise preserve a still-valid user
 * choice, falling back to the first invoice only when the old choice vanished.
 */
export function nextInvoiceId(
  invoices: Pick<InvoiceSummary, 'id'>[],
  currentInvoiceId: string,
  preferredInvoiceId?: string,
): string {
  if (preferredInvoiceId && invoices.some((invoice) => invoice.id === preferredInvoiceId)) {
    return preferredInvoiceId
  }
  if (invoices.some((invoice) => invoice.id === currentInvoiceId)) return currentInvoiceId
  return invoices[0]?.id ?? ''
}

/** Add or replace one persisted invoice without allowing duplicate options. */
export function upsertInvoice(
  invoices: InvoiceSummary[],
  created: InvoiceSummary,
): InvoiceSummary[] {
  return [...invoices.filter((invoice) => invoice.id !== created.id), created]
    .sort((left, right) => left.invoiceDate.localeCompare(right.invoiceDate)
      || left.invoiceNumber.localeCompare(right.invoiceNumber))
}
