import Link from "next/link";
import { getShipment } from "@/lib/data/shipments";
import { getLineItems } from "@/lib/data/line-items";
import { listSupplierOptions } from "@/lib/data/invoices";
import { Chip } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { LineEntry } from "./line-entry";
import { AddInvoiceCard } from "./add-invoice-card";
import { ReviewXmlButton } from "./review-xml-button";
import { getDeclarationProfile } from "@/lib/data/declaration-profile";
import { DeclarationProfileCard } from "./declaration-profile-card";

/**
 * LINE ITEM ENTRY — the crown jewel.
 *
 * Server Component fetches the shipment + its existing line items, renders the
 * static header, then hands everything to <LineEntry/> (client) which owns the
 * live entry row and instant duty preview.
 *
 * In current App Router releases, `params` is a Promise — hence the await.
 */
export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [shipment, lines, declarationProfile] = await Promise.all([getShipment(id), getLineItems(id), getDeclarationProfile(id)]);
  const suppliers = await listSupplierOptions();

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
        {shipment.status === "DRAFT" && <Link href={`/shipments/${id}/edit`} className="sb-btn"><span aria-hidden>✎</span> Edit shipment</Link>}
        <ReviewXmlButton shipmentId={id} status={shipment.status} disabled={shipment.totals === null} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 4 }}>
        <h1 className="sb-h1">Line item entry</h1>
        <span className="sb-meta">
          Waybill {shipment.blNumber} · {shipment.consigneeName} · {lines.length} lines
        </span>
      </div>

      <DeclarationProfileCard initial={declarationProfile} />

      {/* Invoice summary — one shipment can carry multiple commercial invoices. */}
      <div
        className="sb-card"
        style={{ overflow: "hidden", margin: "14px 0" }}
      >
        <table className="sb-tbl">
          <thead><tr><th>Supplier</th><th>Invoice</th><th>Currency / BSD rate</th><th>Incoterm</th><th className="sb-num">Invoice total</th></tr></thead>
          <tbody>
            {shipment.invoices.length === 0 ? (
              <tr><td colSpan={5} className="sb-meta">No commercial invoices attached.</td></tr>
            ) : shipment.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="sb-strong">{invoice.supplierName}</td>
                <td className="sb-mono">{invoice.invoiceNumber} · {invoice.invoiceDate}</td>
                <td className="sb-mono">{invoice.currency} · {invoice.exchangeRate}</td>
                <td>{invoice.incotermCode ?? "—"}{invoice.incotermLocation ? ` ${invoice.incotermLocation}` : ""}</td>
                <td className="sb-num sb-mono">{money(invoice.subTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 24, padding: "9px 14px", borderTop: "1px solid var(--sb-line)" }}>
          <span className="sb-meta">Shipment freight <b className="sb-mono">{money(shipment.freightCharge)}</b></span>
          <span className="sb-meta">Insurance <b className="sb-mono">{money(shipment.insuranceCharge)}</b></span>
        </div>
      </div>

      <AddInvoiceCard shipmentId={id} suppliers={suppliers} />

      <LineEntry
        shipmentId={id}
        status={shipment.status}
        hasInvoice={shipment.invoice !== null}
        invoices={shipment.invoices}
        initialLines={lines}
        initialTotals={shipment.totals}
      />
    </div>
  );
}
