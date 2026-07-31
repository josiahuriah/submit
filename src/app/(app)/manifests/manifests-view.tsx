"use client";

import { useState, useTransition } from "react";
import { Chip } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import {
  createManifest,
  type AgentOption,
  type ManifestListItem,
  type VoyageOption,
} from "@/lib/data/manifests";

/**
 * Manifests — list + create. A manifest ties a voyage (global fixture) to this
 * brokerage; shipments then attach to it. Creation happens through the
 * createManifest Server Action; refusals come back as data and render inline.
 */
export function ManifestsView({
  initialRows,
  voyages,
  agents,
}: {
  initialRows: ManifestListItem[];
  voyages: VoyageOption[];
  agents: AgentOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [open, setOpen] = useState(initialRows.length === 0);
  const [draft, setDraft] = useState({ manifestNumber: "", voyageId: voyages[0]?.id ?? "", shippingAgentId: "", notes: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (pending || !draft.manifestNumber.trim() || !draft.voyageId) return;
    setNotice(null);
    startTransition(async () => {
      const result = await createManifest(draft); // SERVER
      if (result.error) {
        setNotice(result.error);
        return;
      }
      if (result.manifest) {
        setRows((r) => [result.manifest!, ...r]);
        setDraft((d) => ({ ...d, manifestNumber: "", notes: "" }));
        setOpen(false);
      }
    });
  }

  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };

  return (
    <div className="sb-page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
        <h1 className="sb-h1">Manifests</h1>
        <span className="sb-meta">{rows.length} total</span>
        <div style={{ flex: 1 }} />
        <button className="sb-btn is-primary" onClick={() => setOpen((o) => !o)}>
          <Icons.plus /> New manifest
        </button>
      </div>

      {open && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16 }}>
          {notice && (
            <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>
              {notice}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr", gap: 12, marginBottom: 12 }}>
            <label style={field}>
              <span className="sb-eyebrow">Manifest number</span>
              <input
                className="sb-inp sb-mono"
                value={draft.manifestNumber}
                onChange={(e) => setDraft((d) => ({ ...d, manifestNumber: e.target.value }))}
                placeholder="MAN-2026-0001"
              />
            </label>
            <label style={field}>
              <span className="sb-eyebrow">Voyage</span>
              <select
                className="sb-inp"
                value={draft.voyageId}
                onChange={(e) => setDraft((d) => ({ ...d, voyageId: e.target.value }))}
              >
                {voyages.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </label>
            <label style={field}>
              <span className="sb-eyebrow">Shipping agent</span>
              <select
                className="sb-inp"
                value={draft.shippingAgentId}
                onChange={(e) => setDraft((d) => ({ ...d, shippingAgentId: e.target.value }))}
              >
                <option value="">—</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <label style={{ ...field, flex: 1 }}>
              <span className="sb-eyebrow">Notes</span>
              <input
                className="sb-inp"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Optional"
              />
            </label>
            <button className="sb-btn is-primary" onClick={submit} disabled={pending || !draft.manifestNumber.trim() || !draft.voyageId}>
              {pending ? "Creating…" : "Create manifest"}
            </button>
          </div>
        </div>
      )}

      <div className="sb-card" style={{ overflow: "hidden" }}>
        <table className="sb-tbl">
          <thead>
            <tr>
              <th>Manifest #</th>
              <th>Vessel</th>
              <th>Voyage</th>
              <th>Arrival</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="sb-meta" style={{ textAlign: "center", padding: 24 }}>
                  No manifests yet — create one to attach shipments to a voyage.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.id}>
                  <td className="sb-mono sb-strong">{m.manifestNumber}</td>
                  <td>{m.vesselName}</td>
                  <td className="sb-mono">{m.voyageNumber}</td>
                  <td className="sb-mono">{m.arrival}</td>
                  <td className="sb-mono">{m.registeredAt}</td>
                  <td><Chip kind={m.status === "OPEN" ? "draft" : "acc"}>{m.status}</Chip></td>
                  <td className="sb-meta">{m.notes ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
