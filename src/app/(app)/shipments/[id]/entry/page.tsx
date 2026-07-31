import Link from "next/link";
import { getShipment } from "@/lib/data/shipments";
import { getLineItems } from "@/lib/data/line-items";
import { listSupplierOptions } from "@/lib/data/invoices";
import { Chip } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { LineEntry } from "./line-entry";
import { AddInvoiceCard } from "./add-invoice-card";
import { SubmitButton } from "./submit-button";

/**
 * LINE ITEM ENTRY — the crown jewel.
 *
 * Server Component fetches the shipment + its existing line items, renders the
 * static header, then hands everything to <LineEntry/> (client) which owns the
 * live entry row and instant duty preview.
 *
 * In Next.js 15, `params` is a Promise — hence the await.
 */
export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [shipment, lines] = await Promise.all([getShipment(id), getLineItems(id)]);
  // Supplier picker data is only needed while the shipment lacks an invoice.
  const suppliers = shipment.invoice ? [] : await listSupplierOptions();

  return (
    <div className="sb-page" style={{ maxWidth: 1560 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span className="sb-meta">
          <Link href="/shipments" className="sb-rowlink">Shipments</Link>
          {" / "}
          <b style={{ color: "var(--sb-ink)" }}>{shipment.blNumber}</b>
        </span>
        <Chip kind={shipment.status === "DRAFT" ? "draft" : "acc"}>{shipment.status}</Chip>
        <div style={{ flex: 1 }} />
        <SubmitButton shipmentId={id} status={shipment.status} disabled={shipment.totals === null} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 4 }}>
        <h1 className="sb-h1">Line item entry</h1>
        <span className="sb-meta">
          Waybill {shipment.blNumber} · {shipment.consigneeName} · {lines.length} lines
        </span>
      </div>

      {/* Invoice header — static, from the server */}
      <div
        className="sb-card"
        style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1.2fr", overflow: "hidden", margin: "14px 0" }}
      >
        {([
          ["Supplier", shipment.invoice?.supplierName ?? "—", false],
          [
            "Invoice",
            shipment.invoice ? `${shipment.invoice.invoiceNumber} · ${shipment.invoice.invoiceDate}` : "—",
            false,
          ],
          ["Freight", money(shipment.freightCharge), true],
          ["Insurance", money(shipment.insuranceCharge), true],
          ["Invoice total", shipment.invoice ? money(shipment.invoice.subTotal) : "—", true],
        ] as [string, string, boolean][]).map((c, i) => (
          <div key={i} style={{ padding: "12px 16px", borderRight: i < 4 ? "1px solid var(--sb-line)" : "none" }}>
            <div className="sb-eyebrow" style={{ marginBottom: 3 }}>{c[0]}</div>
            <div className={c[2] ? "sb-mono sb-strong" : "sb-strong"}>{c[1]}</div>
          </div>
        ))}
      </div>

      {!shipment.invoice && <AddInvoiceCard shipmentId={id} suppliers={suppliers} />}

      <LineEntry
        shipmentId={id}
        status={shipment.status}
        hasInvoice={shipment.invoice !== null}
        initialLines={lines}
        initialTotals={shipment.totals}
      />
    </div>
  );
}
