"use client";

import { useState, useTransition } from "react";
import { Chip } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import {
  createManifest,
  createRoute,
  createShippingAgent,
  createVessel,
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
  const [vesselOptions, setVesselOptions] = useState(references.vessels);
  const [journeyOptions, setJourneyOptions] = useState(references.journeys);
  const [open, setOpen] = useState(initialRows.length === 0);
  const [referenceForm, setReferenceForm] = useState<"voyage" | "agent" | "vessel" | "route" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ manifestNumber: "", voyageId: voyages[0]?.id ?? "", shippingAgentId: "", registeredAt: "", status: "OPEN", notes: "" });
  const [voyageDraft, setVoyageDraft] = useState({ vesselId: references.vessels[0]?.id ?? "", journeyId: references.journeys[0]?.id ?? "", voyageNumber: "", departureDate: "", arrivalDate: "" });
  const [agentDraft, setAgentDraft] = useState({ name: "", code: "", email: "", phone: "" });
  const initialMode: "SEA" | "AIR" = references.carriers.some((carrier) => carrier.mode === "SEA") ? "SEA" : "AIR";
  const initialOriginPort = references.ports.find((port) => port.unLocode === "USMIA") ?? references.ports[0];
  const initialDestinationPort = references.ports.find((port) => port.unLocode === "BSNAS" && port.id !== initialOriginPort?.id)
    ?? references.ports.find((port) => port.id !== initialOriginPort?.id);
  const [vesselDraft, setVesselDraft] = useState({
    carrierId: references.carriers.find((carrier) => carrier.mode === initialMode)?.id ?? "",
    name: "",
    mode: initialMode,
    imoNumber: "",
  });
  const [routeDraft, setRouteDraft] = useState({
    originPortId: initialOriginPort?.id ?? "",
    destinationPortId: initialDestinationPort?.id ?? "",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matchingCarriers = references.carriers.filter((carrier) => carrier.mode === vesselDraft.mode);

  function toggleReferenceForm(form: "voyage" | "agent" | "vessel" | "route") {
    setNotice(null);
    setReferenceForm((current) => current === form ? null : form);
  }

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

  function changeVesselMode(mode: "SEA" | "AIR") {
    setVesselDraft((current) => ({
      ...current,
      mode,
      carrierId: references.carriers.find((carrier) => carrier.mode === mode)?.id ?? "",
      imoNumber: mode === "AIR" ? "" : current.imoNumber,
    }));
  }

  function submitVessel() {
    if (pending || !vesselDraft.carrierId || !vesselDraft.name.trim()) return;
    setNotice(null);
    startTransition(async () => {
      const result = await createVessel(vesselDraft);
      if (!result.vessel) {
        setNotice(result.error ?? "Could not create the vessel or aircraft");
        return;
      }
      setVesselOptions((current) => [...current, result.vessel!].sort((a, b) => a.label.localeCompare(b.label)));
      setVoyageDraft((current) => ({ ...current, vesselId: result.vessel!.id }));
      setVesselDraft((current) => ({ ...current, name: "", imoNumber: "" }));
      setReferenceForm("voyage");
      setNotice(`${result.vessel.label} was added and selected for the new voyage.`);
    });
  }

  function submitRoute() {
    if (pending || !routeDraft.originPortId || !routeDraft.destinationPortId || routeDraft.originPortId === routeDraft.destinationPortId) return;
    setNotice(null);
    startTransition(async () => {
      const result = await createRoute(routeDraft);
      if (!result.route) {
        setNotice(result.error ?? "Could not create the route");
        return;
      }
      setJourneyOptions((current) => [...current, result.route!].sort((a, b) => a.label.localeCompare(b.label)));
      setVoyageDraft((current) => ({ ...current, journeyId: result.route!.id }));
      setReferenceForm("voyage");
      setNotice(`${result.route.label} was added and selected for the new voyage.`);
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
        <button className="sb-btn is-primary" onClick={() => { setEditingId(null); setOpen((o) => !o); }}>
          <Icons.plus /> New manifest
        </button>
      </div>

      <div className="sb-card sb-pad" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ marginRight: "auto", minWidth: 220 }}>
          <div className="sb-h2">Transport setup</div>
          <div className="sb-meta">Shared vessels, aircraft, routes, voyages and agents used by manifests.</div>
        </div>
        <button className="sb-btn" onClick={() => toggleReferenceForm("agent")}><Icons.plus /> Shipping agent</button>
        <button className="sb-btn" onClick={() => toggleReferenceForm("vessel")}><Icons.plus /> Vessel / aircraft</button>
        <button className="sb-btn" onClick={() => toggleReferenceForm("route")}><Icons.plus /> Route</button>
        <button className="sb-btn" onClick={() => toggleReferenceForm("voyage")}><Icons.plus /> Voyage / flight</button>
      </div>

      {referenceForm === "vessel" && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--sb-accent)" }}>
          <div className="sb-h2" style={{ marginBottom: 4 }}>Add vessel or aircraft</div>
          <div className="sb-meta" style={{ marginBottom: 12 }}>Choose the transport mode first; only carriers configured for that mode are available.</div>
          {notice && <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>{notice}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
            <label style={field}>
              <span className="sb-eyebrow">Transport mode</span>
              <select className="sb-inp" value={vesselDraft.mode} onChange={(e) => changeVesselMode(e.target.value as "SEA" | "AIR")}>
                <option value="SEA">Sea — vessel</option>
                <option value="AIR">Air — aircraft</option>
              </select>
            </label>
            <label style={field}>
              <span className="sb-eyebrow">Carrier</span>
              <select className="sb-inp" value={vesselDraft.carrierId} onChange={(e) => setVesselDraft((current) => ({ ...current, carrierId: e.target.value }))}>
                {matchingCarriers.length === 0 && <option value="">No matching carrier configured</option>}
                {matchingCarriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.label}</option>)}
              </select>
            </label>
            <label style={field}>
              <span className="sb-eyebrow">{vesselDraft.mode === "SEA" ? "Vessel name" : "Aircraft name"}</span>
              <input className="sb-inp" value={vesselDraft.name} onChange={(e) => setVesselDraft((current) => ({ ...current, name: e.target.value }))} placeholder={vesselDraft.mode === "SEA" ? "Tropic Freedom" : "Cargo aircraft"} />
            </label>
            {vesselDraft.mode === "SEA" && (
              <label style={field}>
                <span className="sb-eyebrow">IMO number <span className="sb-meta">(optional)</span></span>
                <input className="sb-inp sb-mono" value={vesselDraft.imoNumber} onChange={(e) => setVesselDraft((current) => ({ ...current, imoNumber: e.target.value.toUpperCase() }))} />
              </label>
            )}
            <button className="sb-btn is-primary" onClick={submitVessel} disabled={pending || !vesselDraft.carrierId || !vesselDraft.name.trim()}>{pending ? "Saving…" : vesselDraft.mode === "SEA" ? "Add vessel" : "Add aircraft"}</button>
          </div>
          {matchingCarriers.length === 0 && <div className="sb-meta" style={{ marginTop: 10 }}>No active {vesselDraft.mode.toLowerCase()} carrier is configured. A carrier must exist before adding this transport asset.</div>}
        </div>
      )}

      {referenceForm === "route" && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--sb-accent)" }}>
          <div className="sb-h2" style={{ marginBottom: 4 }}>Add route</div>
          <div className="sb-meta" style={{ marginBottom: 12 }}>A route connects two existing ports and can be reused by future voyages and flights.</div>
          {notice && <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>{notice}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 1fr) auto", gap: 12, alignItems: "end" }}>
            <label style={field}>
              <span className="sb-eyebrow">Origin port</span>
              <select className="sb-inp" value={routeDraft.originPortId} onChange={(e) => setRouteDraft((current) => ({ ...current, originPortId: e.target.value }))}>
                {references.ports.map((port) => <option key={port.id} value={port.id}>{port.label}</option>)}
              </select>
            </label>
            <label style={field}>
              <span className="sb-eyebrow">Destination port</span>
              <select className="sb-inp" value={routeDraft.destinationPortId} onChange={(e) => setRouteDraft((current) => ({ ...current, destinationPortId: e.target.value }))}>
                {references.ports.map((port) => <option key={port.id} value={port.id}>{port.label}</option>)}
              </select>
            </label>
            <button className="sb-btn is-primary" onClick={submitRoute} disabled={pending || references.ports.length < 2 || !routeDraft.originPortId || !routeDraft.destinationPortId || routeDraft.originPortId === routeDraft.destinationPortId}>{pending ? "Saving…" : "Add route"}</button>
          </div>
          {references.ports.length < 2 && <div className="sb-meta" style={{ marginTop: 10 }}>At least two active ports must be configured before a route can be added.</div>}
        </div>
      )}

      {referenceForm === "voyage" && (
        <div className="sb-card sb-pad" style={{ marginBottom: 16, borderLeft: "3px solid var(--sb-accent)" }}>
          <div className="sb-h2" style={{ marginBottom: 4 }}>Add voyage</div>
          <div className="sb-meta" style={{ marginBottom: 12 }}>Create a sailing or flight from a vessel or aircraft and an optional reusable route.</div>
          {notice && <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>{notice}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.5fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
            <label style={field}><span className="sb-eyebrow">Vessel / aircraft</span><select className="sb-inp" value={voyageDraft.vesselId} onChange={(e) => setVoyageDraft((current) => ({ ...current, vesselId: e.target.value }))}>{vesselOptions.map((vessel) => <option key={vessel.id} value={vessel.id}>{vessel.label}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Route</span><select className="sb-inp" value={voyageDraft.journeyId} onChange={(e) => setVoyageDraft((current) => ({ ...current, journeyId: e.target.value }))}><option value="">— no route —</option>{journeyOptions.map((journey) => <option key={journey.id} value={journey.id}>{journey.label}</option>)}</select></label>
            <label style={field}><span className="sb-eyebrow">Voyage / flight #</span><input className="sb-inp sb-mono" value={voyageDraft.voyageNumber} onChange={(e) => setVoyageDraft((current) => ({ ...current, voyageNumber: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Departure</span><input type="date" className="sb-inp sb-mono" value={voyageDraft.departureDate} onChange={(e) => setVoyageDraft((current) => ({ ...current, departureDate: e.target.value }))} /></label>
            <label style={field}><span className="sb-eyebrow">Arrival</span><input type="date" className="sb-inp sb-mono" value={voyageDraft.arrivalDate} onChange={(e) => setVoyageDraft((current) => ({ ...current, arrivalDate: e.target.value }))} /></label>
            <button className="sb-btn is-primary" onClick={submitVoyage} disabled={pending || !voyageDraft.vesselId || !voyageDraft.voyageNumber.trim()}>{pending ? "Saving…" : "Add voyage"}</button>
          </div>
          {vesselOptions.length === 0 && <div className="sb-meta" style={{ marginTop: 10 }}>No vessel or aircraft is available yet. Use “Vessel / aircraft” above, then return to this form.</div>}
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
