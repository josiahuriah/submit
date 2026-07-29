import Link from "next/link";
import { listShipments } from "@/lib/data/shipments";
import { ShipmentsTable } from "./shipments-table";
import { Icons } from "@/components/ui/icons";

/**
 * SHIPMENTS — the canonical list page.
 *
 * PATTERN: a Server Component does the data fetch (no client JS shipped for it,
 * no loading spinner needed, no API round-trip from the browser), then passes
 * plain data to a small Client Component that owns the interactivity (tab
 * filtering + search). This split keeps the JS bundle tiny — only the
 * interactive bits hydrate.
 */
export default async function ShipmentsPage() {
  const { rows } = await listShipments();

  return (
    <div className="sb-page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
        <h1 className="sb-h1">Shipments</h1>
        <span className="sb-meta">{rows.length} total · last 30 days</span>
        <div style={{ flex: 1 }} />
        <Link href="/shipments/new/entry" className="sb-btn is-primary">
          <Icons.plus /> New shipment
        </Link>
      </div>

      <ShipmentsTable rows={rows} />
    </div>
  );
}
