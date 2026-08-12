"use client";

import { useState, useTransition } from "react";
import { Chip } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import {
  createManifest,
  createShippingAgent,
  createVoyage,
  updateManifest,
  type AgentOption,
  type ManifestReferenceOptions,
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
  references,
}: {
  initialRows: ManifestListItem[];
  voyages: VoyageOption[];
  agents: AgentOption[];
  references: ManifestReferenceOptions;
}) {
  const [rows, setRows] = useState(initialRows);
  const [voyageOptions, setVoyageOptions] = useState(voyages);
  const [agentOptions, setAgentOptions] = useState(agents);
  const [open, setOpen] = useState(initialRows.length === 0);
  const [referenceForm, setReferenceForm] = useState<"voyage" | "agent" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ manifestNumber: "", voyageId: voyages[0]?.id ?? "", shippingAgentId: "", registeredAt: "", status: "OPEN", notes: "" });
  const [voyageDraft, setVoyageDraft] = useState({ vesselId: references.vessels[0]?.id ?? "", journeyId: references.journeys[0]?.id ?? "", voyageNumber: "", departureDate: "", arrivalDate: "" });
  const [agentDraft, setAgentDraft] = useState({ name: "", code: "", email: "", phone: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitAgent() {
    if (pending || !agentDraft.name.trim()) return;
    setNotice(null);
    startTransition(async () => {
      const result = await createShippingAgent(agentDraft);
      if (!result.agent) {
        setNotice(result.error ?? "Could not create the shipping agent");
        return;
      }
      setAgentOptions((current) => [...current, result.agent!].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft((current) => ({ ...current, shippingAgentId: result.agent!.id }));
      setAgentDraft({ name: "", code: "", email: "", phone: "" });
      setReferenceForm(null);
      setOpen(true);
      setNotice(`${result.agent.name} was added and selected.`);
    });
  }

  function submitVoyage() {
    if (pending || !voyageDraft.vesselId || !voyageDraft.voyageNumber.trim()) return;
    setNotice(null);
    startTransition(async () => {
      const result = await createVoyage(voyageDraft);
      if (!result.voyage) {
        setNotice(result.error ?? "Could not create the voyage");
        return;
      }
      setVoyageOptions((current) => [result.voyage!, ...current]);
      setDraft((current) => ({ ...current, voyageId: result.voyage!.id }));
      setVoyageDraft((current) => ({ ...current, voyageNumber: "", departureDate: "", arrivalDate: "" }));
      setReferenceForm(null);
      setOpen(true);
      setNotice(`${result.voyage.label} was added and selected.`);
    });
  }

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
        setDraft((d) => ({ ...d, manifestNumber: "", registeredAt: "", status: "OPEN", notes: "" }));
        setOpen(false);
      }
    });
  }

  function beginEdit(manifest: ManifestListItem) {
    setEditingId(manifest.id);
    setOpen(false);
    setNotice(null);
    setDraft({
      manifestNumber: manifest.manifestNumber,
      voyageId: manifest.voyageId,
      shippingAgentId: manifest.shippingAgentId ?? "",
      registeredAt: manifest.registeredAt === "—" ? "" : manifest.registeredAt,
      status: manifest.status,
      notes: manifest.notes ?? "",
    });
  }

  function saveEdit() {
    if (!editingId || pending || !draft.manifestNumber.trim() || !draft.voyageId) return;
    setNotice(null);
    startTransition(async () => {
      const result = await updateManifest(editingId, draft); // SERVER
      if (result.error || !result.manifest) {
        setNotice(result.error ?? "Could not update the manifest");
        return;
      }
      setRows((current) => current.map((row) => row.id === editingId ? result.manifest! : row));
      setEditingId(null);
    });
  }

  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };

  return (
    <div className="sb-page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 14 }}>
        <h1 className="sb-h1">Manifests</h1>
        <span className="sb-meta">{rows.length} total</span>
        <div style={{ flex: 1 }} />
        <button className="sb-btn" onClick={() => setReferenceForm((current) => current === "voyage" ? null : "voyage")}><Icons.plus /> New voyage</button>
        <button className="sb-btn" onClick={() => setReferenceForm((current) => current === "agent" ? null : "agent")}><Icons.plus /> New shipping agent</button>
        <button className="sb-btn is-primary" onClick={() => { setEditingId(null); setOpen((o) => !o); }}>
          <Icons.plus /> New manifest
        </button>
      </div>

      {referenceForm === "voyage" && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--sb-accent)" }}>
          <div className="sb-h2" style={{ marginBottom: 4 }}>Add voyage</div>
          <div className="sb-meta" style={{ marginBottom: 12 }}>Voyages use an existing vessel and route from the shared transport directory.</div>
          {notice && <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>{notice}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <label style={field}><span className="sb-eyebrow">Vessel / aircraft</span><select className="sb-inp" value={voyageDraft.vesselId} onChange={(e) => setVoyageDraft((current) => ({ ...current, vesselId: e.target.value }))}>{references.vessels.map((vessel) => <option key={vessel.id} value={vessel.id}>{vessel.label}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Route</span><select className="sb-inp" value={voyageDraft.journeyId} onChange={(e) => setVoyageDraft((current) => ({ ...current, journeyId: e.target.value }))}><option value="">— no route —</option>{references.journeys.map((journey) => <option key={journey.id} value={journey.id}>{journey.label}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Voyage / flight #</span><input className="sb-inp sb-mono" value={voyageDraft.voyageNumber} onChange={(e) => setVoyageDraft((current) => ({ ...current, voyageNumber: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Departure</span><input type="date" className="sb-inp sb-mono" value={voyageDraft.departureDate} onChange={(e) => setVoyageDraft((current) => ({ ...current, departureDate: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Arrival</span><input type="date" className="sb-inp sb-mono" value={voyageDraft.arrivalDate} onChange={(e) => setVoyageDraft((current) => ({ ...current, arrivalDate: e.target.value }))} /></label>
            <button className="sb-btn is-primary" onClick={submitVoyage} disabled={pending || !voyageDraft.vesselId || !voyageDraft.voyageNumber.trim()}>{pending ? "Saving…" : "Add voyage"}</button>
          </div>
          {references.vessels.length === 0 && <div className="sb-meta" style={{ marginTop: 10 }}>No active sea or air vessels are configured. Add one to the reference seed before creating a voyage.</div>}
        </div>
      )}

      {referenceForm === "agent" && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--sb-accent)" }}>
          <div className="sb-h2" style={{ marginBottom: 4 }}>Add shipping agent</div>
          <div className="sb-meta" style={{ marginBottom: 12 }}>The new agent remains available in the shared manifest directory.</div>
          {notice && <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>{notice}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr 1fr auto", gap: 12, alignItems: "end" }}>
            <label style={field}><span className="sb-eyebrow">Name</span><input className="sb-inp" value={agentDraft.name} onChange={(e) => setAgentDraft((current) => ({ ...current, name: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Code</span><input className="sb-inp sb-mono" value={agentDraft.code} onChange={(e) => setAgentDraft((current) => ({ ...current, code: e.target.value.toUpperCase() }))} /></label>
            <label style={field}><span className="sb-eyebrow">Email</span><input type="email" className="sb-inp" value={agentDraft.email} onChange={(e) => setAgentDraft((current) => ({ ...current, email: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Phone</span><input className="sb-inp" value={agentDraft.phone} onChange={(e) => setAgentDraft((current) => ({ ...current, phone: e.target.value }))} /></label>
            <button className="sb-btn is-primary" onClick={submitAgent} disabled={pending || !agentDraft.name.trim()}>{pending ? "Saving…" : "Add agent"}</button>
          </div>
        </div>
      )}

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
                {voyageOptions.length === 0 && <option value="">Create a voyage above</option>}
                {voyageOptions.map((v) => (
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
                {agentOptions.map((a) => (
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

      {editingId && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--sb-accent)" }}>
          <div className="sb-h2" style={{ marginBottom: 12 }}>Edit manifest</div>
          {notice && <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>{notice}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label style={field}><span className="sb-eyebrow">Manifest number</span><input className="sb-inp sb-mono" value={draft.manifestNumber} onChange={(e) => setDraft((d) => ({ ...d, manifestNumber: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Voyage</span><select className="sb-inp" value={draft.voyageId} onChange={(e) => setDraft((d) => ({ ...d, voyageId: e.target.value }))}>{voyageOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Shipping agent</span><select className="sb-inp" value={draft.shippingAgentId} onChange={(e) => setDraft((d) => ({ ...d, shippingAgentId: e.target.value }))}><option value="">—</option>{agentOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Status</span><select className="sb-inp" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></label>
            <label style={field}><span className="sb-eyebrow">Registered</span><input type="date" className="sb-inp sb-mono" value={draft.registeredAt} onChange={(e) => setDraft((d) => ({ ...d, registeredAt: e.target.value }))} /></label>
            <label style={{ ...field, gridColumn: "span 3" }}><span className="sb-eyebrow">Notes</span><input className="sb-inp" value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} /></label>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button className="sb-btn" onClick={() => setEditingId(null)} disabled={pending}>Cancel</button><button className="sb-btn is-primary" onClick={saveEdit} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button></div>
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
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="sb-meta" style={{ textAlign: "center", padding: 24 }}>
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
                  <td><button className="sb-btn is-sm" onClick={() => beginEdit(m)}><Icons.edit /> Edit</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
