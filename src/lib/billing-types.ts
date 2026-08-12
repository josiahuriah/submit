export type BillingStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID'

export interface BillingItemRow {
  id: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
  shipmentId: string | null
}

export interface PaymentRow {
  id: string
  amount: string
  method: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER' | 'CARD' | 'OTHER'
  reference: string | null
  receivedAt: string
}

export interface BillingInvoiceRow {
  id: string
  invoiceNumber: string
  status: BillingStatus
  issueDate: string
  dueDate: string | null
  subtotal: string
  vatAmount: string
  total: string
  amountPaid: string
  notes: string | null
  client: { id: string; name: string }
  items: BillingItemRow[]
  payments: PaymentRow[]
}

export interface ClientOptionRow {
  id: string
  name: string
  isActive: boolean
}

export interface ShipmentOptionRow {
  id: string
  shipmentNumber: string
  status: string
  client: { id: string; name: string }
}
