"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { cn } from "@/lib/format";
import type { ChipKind, ShipmentListItem, ShipmentStatus } from "@/lib/types";

// Maps the ShipmentStatus enum to a chip color + display label. Centralizing
// this here (and, in your real app, in lib/labels.ts) keeps status vocabulary
// consistent everywhere.
const STATUS: Record<ShipmentStatus, { kind: ChipKind; label: string }> = {
  DRAFT:     { kind: "draft", label: "Draft" },
  SUBMITTED: { kind: "acc",   label: "Submitted" },
  CLEARED:   { kind: "pos",   label: "Cleared" },
  CANCELLED: { kind: "draft", label: "Cancelled" },
};

type TabId = "all" | ShipmentStatus;

const TABS: { id: TabId; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "DRAFT",     label: "Draft" },
  { id: "SUBMITTED", label: "Submitted" },
  { id: "CLEARED",   label: "Cleared" },
  { id: "CANCELLED", label: "Cancelled" },
];

export function ShipmentsTable({ rows, initialQuery = "" }: { rows: ShipmentListItem[]; initialQuery?: string }) {
  const [status, setStatus] = useState<TabId>("all");
  const [query, setQuery] = useState(initialQuery);

  // Counts per tab, derived from the full set (not the filtered view).
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!q ||
          (r.blNumber + r.consigneeName + r.description + r.manifestNumber)
            .toLowerCase()
            .includes(q))
    );
  }, [rows, status, query]);

  return (
    <>
      <div className="sb-stabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={cn("sb-stab", status === t.id && "is-active")}
            onClick={() => setStatus(t.id)}
          >
            {t.label}
            <span className="sb-count">{counts[t.id] ?? 0}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="sb-search" style={{ margin: "3px 0" }}>
          <Icons.search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search waybill, client…"
          />
        </div>
      </div>

      <div className="sb-card" style={{ overflow: "hidden", marginTop: 14 }}>
        <table className="sb-tbl">
          <thead>
            <tr>
              <th>Ship #</th>
              <th>Waybill #</th>
              <th>Manifest</th>
              <th>Arrival</th>
              <th>Consignee</th>
              <th>Supplier</th>
              <th>Description</th>
              <th>Prepared by</th>
              <th>Status</th>
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const st = STATUS[s.status] ?? STATUS.DRAFT;
              return (
                <tr key={s.id}>
                  <td className="sb-mono">{s.shipmentNumber}</td>
                  <td>
                    <Link href={`/shipments/${s.id}/entry`} className="sb-rowlink sb-mono">
                      {s.blNumber}
                    </Link>
                  </td>
                  <td className="sb-mono sb-soft">{s.manifestNumber}</td>
                  <td className="sb-mono">{s.arrival}</td>
                  <td>{s.consigneeName}</td>
                  <td className="sb-soft">{s.supplier}</td>
                  <td>{s.description}</td>
                  <td className="sb-soft">{s.preparedBy}</td>
                  <td><Chip kind={st.kind}>{st.label}</Chip></td>
                  <td>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <Link href={`/shipments/${s.id}/entry`} className="sb-iconbtn" style={{ width: 26, height: 26, color: "var(--sb-accent)" }} aria-label="Open">
                        <Icons.eye />
                      </Link>
                      <Link href={`/shipments/${s.id}/edit`} className="sb-iconbtn" style={{ width: 26, height: 26, color: "var(--sb-ink-3)" }} aria-label="Edit">
                        <Icons.edit />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="sb-meta" style={{ textAlign: "center", padding: 24, fontStyle: "italic" }}>
                  No shipments match. Adjust the filter or search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sb-meta" style={{ textAlign: "right", padding: "10px 4px" }}>
        {filtered.length} of {rows.length} shipments
      </div>
    </>
  );
}
