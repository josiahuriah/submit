"use client";

import { useState } from "react";
import type { SupplierOption } from "@/lib/data/invoices";
import { nextInvoiceId, upsertInvoice } from "@/lib/invoice-selection";
import type { InvoiceSummary, LineItem, ShipmentStatus, ShipmentTotals } from "@/lib/types";
import { AddInvoiceCard } from "./add-invoice-card";
import { LineEntry } from "./line-entry";

/**
 * Owns the client-side handoff from supplier-invoice creation to line entry.
 * A route refresh alone is insufficient because LineEntry intentionally keeps
 * an in-progress draft; this boundary updates only the invoice options and
 * preferred selection without discarding anything else the broker has typed.
 */
export function InvoiceLineWorkspace({
  shipmentId,
  status,
  suppliers,
  initialInvoices,
  initialLines,
  initialTotals,
}: {
  shipmentId: string;
  status: ShipmentStatus;
  suppliers: SupplierOption[];
  initialInvoices: InvoiceSummary[];
  initialLines: LineItem[];
  initialTotals: ShipmentTotals | null;
}) {
  const [createdInvoices, setCreatedInvoices] = useState<InvoiceSummary[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(initialInvoices[0]?.id ?? "");
  const [invoiceVersion, setInvoiceVersion] = useState(0);
  const invoices = createdInvoices.reduce(upsertInvoice, initialInvoices);
  const effectiveInvoiceId = nextInvoiceId(invoices, selectedInvoiceId);

  function invoiceCreated(invoice: InvoiceSummary) {
    setCreatedInvoices((current) => upsertInvoice(current, invoice));
    setSelectedInvoiceId(invoice.id);
    setInvoiceVersion((current) => current + 1);
  }

  return (
    <>
      <AddInvoiceCard shipmentId={shipmentId} suppliers={suppliers} onInvoiceCreated={invoiceCreated} />
      <LineEntry
        shipmentId={shipmentId}
        status={status}
        invoices={invoices}
        selectedInvoiceId={effectiveInvoiceId}
        onInvoiceIdChange={setSelectedInvoiceId}
        invoiceVersion={invoiceVersion}
        initialLines={initialLines}
        initialTotals={initialTotals}
      />
    </>
  );
}
