"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addInvoice, type SupplierOption } from "@/lib/data/invoices";

/**
 * Shown when the shipment has no supplier invoice yet — line entry cannot
 * begin until one exists (commitLineItem refuses). On success we refresh the
 * route so the Server Component re-reads the shipment with its new invoice.
 */
export function AddInvoiceCard({
  shipmentId,
  suppliers,
}: {
  shipmentId: string;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    supplierId: suppliers[0]?.id ?? "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    subTotal: "",
    currency: "BSD",
    exchangeRate: "1",
    incotermCode: "FOB",
    incotermLocation: "",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pending || !draft.supplierId || !draft.invoiceNumber.trim()) return;
    setNotice(null);
    startTransition(async () => {
      const result = await addInvoice(shipmentId, draft); // SERVER
      if (result.error) {
        setNotice(result.error);
        return;
      }
      router.refresh();
    });
  }

  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };

  return (
    <div className="sb-card sb-pad" style={{ margin: "14px 0", borderLeft: "3px solid var(--sb-gold)" }}>
      <div style={{ marginBottom: 10 }}>
        <div className="sb-h2">Add supplier invoice</div>
        <div className="sb-meta">Each line is linked to its commercial invoice; foreign currency values are converted with the recorded BSD exchange rate.</div>
      </div>
      {notice && (
        <div style={{ padding: "8px 12px", marginBottom: 10, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>
          {notice}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr .7fr .8fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
        <label style={field}>
          <span className="sb-eyebrow">Supplier</span>
          <select
            className="sb-inp"
            value={draft.supplierId}
            onChange={(e) => setDraft((d) => ({ ...d, supplierId: e.target.value }))}
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label style={field}>
          <span className="sb-eyebrow">Invoice #</span>
          <input
            className="sb-inp sb-mono"
            value={draft.invoiceNumber}
            onChange={(e) => setDraft((d) => ({ ...d, invoiceNumber: e.target.value }))}
            placeholder="INV-1001"
          />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">Invoice date</span>
          <input
            className="sb-inp sb-mono"
            type="date"
            value={draft.invoiceDate}
            onChange={(e) => setDraft((d) => ({ ...d, invoiceDate: e.target.value }))}
          />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">Invoice total</span>
          <input
            className="sb-inp sb-mono"
            value={draft.subTotal}
            onChange={(e) => setDraft((d) => ({ ...d, subTotal: e.target.value }))}
            placeholder="0.00"
          />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">Currency</span>
          <input className="sb-inp sb-mono" maxLength={3} value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">BSD rate</span>
          <input className="sb-inp sb-mono" value={draft.exchangeRate} onChange={(e) => setDraft((d) => ({ ...d, exchangeRate: e.target.value }))} />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">Incoterm</span>
          <input className="sb-inp sb-mono" value={draft.incotermCode} onChange={(e) => setDraft((d) => ({ ...d, incotermCode: e.target.value.toUpperCase() }))} placeholder="FOB" />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">Term location</span>
          <input className="sb-inp" value={draft.incotermLocation} onChange={(e) => setDraft((d) => ({ ...d, incotermLocation: e.target.value }))} placeholder="Miami" />
        </label>
        <button
          className="sb-btn is-primary"
          onClick={submit}
          disabled={pending || !draft.supplierId || !draft.invoiceNumber.trim()}
        >
          {pending ? "Adding…" : "Add invoice"}
        </button>
      </div>
    </div>
  );
}
