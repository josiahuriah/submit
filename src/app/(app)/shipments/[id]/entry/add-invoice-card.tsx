"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addInvoice, type SupplierOption } from "@/lib/data/invoices";
import { ApiClientError, apiRequest } from "@/lib/client-api";

interface CreatedSupplier {
  id: string;
  name: string;
  country: string | null;
}

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
  const [supplierOptions, setSupplierOptions] = useState(suppliers);
  const [showSupplierForm, setShowSupplierForm] = useState(suppliers.length === 0);
  const [supplierPending, setSupplierPending] = useState(false);
  const [supplierDraft, setSupplierDraft] = useState({ name: "", country: "US", address: "", city: "" });
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

  async function createSupplier() {
    if (!supplierDraft.name.trim() || supplierPending) return;
    setSupplierPending(true);
    setNotice(null);
    try {
      const supplier = await apiRequest<CreatedSupplier>("/api/suppliers", {
        method: "POST",
        body: JSON.stringify({
          name: supplierDraft.name.trim(),
          country: supplierDraft.country.trim().toUpperCase() || undefined,
          address: supplierDraft.address.trim() || undefined,
          city: supplierDraft.city.trim() || undefined,
        }),
      });
      const option = { id: supplier.id, label: supplier.country ? `${supplier.name} (${supplier.country})` : supplier.name };
      setSupplierOptions((current) => [...current, option].sort((a, b) => a.label.localeCompare(b.label)));
      setDraft((current) => ({ ...current, supplierId: supplier.id }));
      setSupplierDraft({ name: "", country: "US", address: "", city: "" });
      setShowSupplierForm(false);
      setNotice(`${supplier.name} was saved to this brokerage and selected.`);
    } catch (error) {
      setNotice(error instanceof ApiClientError || error instanceof Error ? error.message : "Could not create the supplier.");
    } finally {
      setSupplierPending(false);
    }
  }

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="sb-meta">Suppliers saved here remain available to this brokerage for future entries.</span>
        <button className="sb-btn is-sm" type="button" onClick={() => setShowSupplierForm((open) => !open)}>
          {showSupplierForm ? "Cancel new supplier" : "+ New supplier"}
        </button>
      </div>
      {showSupplierForm && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr .7fr 2fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 12, padding: 10, background: "var(--sb-surface-2)", borderRadius: 6 }}>
          <label style={field}><span className="sb-eyebrow">Supplier name</span><input className="sb-inp" value={supplierDraft.name} onChange={(e) => setSupplierDraft((current) => ({ ...current, name: e.target.value }))} /></label>
          <label style={field}><span className="sb-eyebrow">Country</span><input className="sb-inp sb-mono" maxLength={2} value={supplierDraft.country} onChange={(e) => setSupplierDraft((current) => ({ ...current, country: e.target.value.toUpperCase() }))} /></label>
          <label style={field}><span className="sb-eyebrow">Address</span><input className="sb-inp" value={supplierDraft.address} onChange={(e) => setSupplierDraft((current) => ({ ...current, address: e.target.value }))} /></label>
          <label style={field}><span className="sb-eyebrow">City</span><input className="sb-inp" value={supplierDraft.city} onChange={(e) => setSupplierDraft((current) => ({ ...current, city: e.target.value }))} /></label>
          <button className="sb-btn is-primary" type="button" onClick={() => void createSupplier()} disabled={supplierPending || !supplierDraft.name.trim()}>{supplierPending ? "Saving…" : "Save supplier"}</button>
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
            {supplierOptions.length === 0 && <option value="">Create a supplier above</option>}
            {supplierOptions.map((s) => (
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
