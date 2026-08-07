/**
 * DATA-ACCESS SEAM — BROKERAGE BILLING (invoices + quotes)
 * -----------------------------------------------------------------------------
 * Reads for the Billing page. Runs on the SERVER (imported by the Billing
 * Server Component), so it calls the service layer directly with a
 * session-scoped TenantClient — every read is org-scoped by construction.
 *
 * Mutations (create / send / convert) live in ./billing-actions.ts as Server
 * Actions, mirroring shipments.ts (reads) + shipment-actions.ts (writes).
 */
import { requireSession } from '@/lib/auth/session'
import { createTenantClient } from '@/lib/db/tenant-client'
import { billingService } from '@/server/services/billing.service'
import { catalogService } from '@/server/services/catalog.service'

export type BillingKind = 'INVOICE' | 'QUOTE'
export type BillingStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID'

export interface BillingDoc {
  id: string
  kind: BillingKind
  number: string
  status: BillingStatus
  clientName: string
  issueDate: string
  dueDate: string
  validUntil: string
  subtotal: string
  vatAmount: string
  total: string
  amountPaid: string
  /** For a converted quote: the invoice number it became. */
  convertedToNumber: string | null
  itemCount: number
}

export interface ClientOption {
  id: string
  label: string
}

async function scoped() {
  const claims = await requireSession()
  return createTenantClient(claims.orgId)
}

/** All brokerage invoices AND quotes for the Billing page. */
export async function listBilling(): Promise<BillingDoc[]> {
  const db = await scoped()
  const page = await billingService.list(db, {})
  return page.items.map(toBillingDoc)
}

/** Clients for the create-document form's dropdown. */
export async function listClientOptions(): Promise<ClientOption[]> {
  const db = await scoped()
  const page = await catalogService.listClients(db, {})
  return page.items.map((c) => ({ id: c.id, label: c.name }))
}

// --- mappers ----------------------------------------------------------------

type Row = Awaited<ReturnType<typeof billingService.list>>['items'][number]

function isoDay(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : '—'
}

function toBillingDoc(row: Row): BillingDoc {
  return {
    id: row.id,
    kind: row.kind as BillingKind,
    number: row.invoiceNumber,
    status: row.status as BillingStatus,
    clientName: row.client.name,
    issueDate: isoDay(row.issueDate),
    dueDate: isoDay(row.dueDate),
    validUntil: isoDay(row.validUntil),
    subtotal: String(row.subtotal),
    vatAmount: String(row.vatAmount),
    total: String(row.total),
    amountPaid: String(row.amountPaid),
    convertedToNumber: row.convertedTo?.invoiceNumber ?? null,
    itemCount: row.items.length,
  }
}
