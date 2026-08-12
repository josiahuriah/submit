"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShipment, type NewShipmentOptions } from "@/lib/data/shipment-actions";

const GOODS_TYPES = ["GENERAL", "PERSONAL_EFFECTS", "COMMERCIAL", "VEHICLE", "HAZARDOUS", "PERISHABLE"];
const PACKAGE_TYPES = ["CARTON", "CONTAINER", "PALLET", "CRATE", "DRUM", "BUNDLE", "LOOSE", "VEHICLE", "OTHER"];
const TRANSPORT_MODES = ["SEA", "AIR"];

function enumLabel(value: string) {
  if (value === "CARTON") return "Box";
  return value.replace(/_/g, " ").toLowerCase();
}

/**
 * New shipment — collects the header fields; the shipment number is allocated
 * server-side (SHP-YYYY-NNNNN, org-scoped). On success we go straight to the
 * entry workspace, where the broker adds the supplier invoice and lines.
 */
export function NewShipmentForm({ options }: { options: NewShipmentOptions }) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    clientId: options.clients[0]?.id ?? "",
    declarationOfficeId: options.offices[0]?.id ?? "",
    manifestId: "",
    blNumber: "",
    containerNumber: "",
    containerSealNumber: "",
    regimeCode: "4",
    goodsType: "GENERAL",
    packageType: "CARTON",
    packageCount: "1",
    transportMode: "SEA",
    description: "",
    grossWeightLb: "",
    netWeightLb: "",
    freightCharge: "",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  function submit() {
    if (pending || !draft.clientId || !draft.declarationOfficeId) return;
    setNotice(null);
    startTransition(async () => {
      const result = await createShipment(draft); // SERVER
      if (result.error || !result.shipmentId) {
        setNotice(result.error ?? "Could not create the shipment");
        return;
      }
      router.push(`/shipments/${result.shipmentId}/entry`);
    });
  }

  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };
  const select = (label: string, key: keyof typeof draft, items: { id: string; label: string }[], allowEmpty?: string) => (
    <label style={field}>
      <span className="sb-eyebrow">{label}</span>
      <select className="sb-inp" value={draft[key]} onChange={set(key)}>
        {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
        {items.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
  const text = (label: string, key: keyof typeof draft, placeholder = "", mono = false) => (
    <label style={field}>
      <span className="sb-eyebrow">{label}</span>
      <input className={mono ? "sb-inp sb-mono" : "sb-inp"} value={draft[key]} onChange={set(key)} placeholder={placeholder} />
    </label>
  );
  const enumSelect = (label: string, key: keyof typeof draft, values: string[]) =>
    select(label, key, values.map((v) => ({ id: v, label: enumLabel(v) })));

  return (
    <div className="sb-page" style={{ maxWidth: 860 }}>
      <h1 className="sb-h1" style={{ marginBottom: 4 }}>New shipment</h1>
      <p className="sb-meta" style={{ marginBottom: 16 }}>
        The shipment number is assigned automatically. Supplier invoice and line items come next, on the entry page.
      </p>

      {notice && (
        <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      <div className="sb-card sb-pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {select("Client (consignee)", "clientId", options.clients)}
        {select("Declaration office", "declarationOfficeId", options.offices)}
        {select("Manifest", "manifestId", options.manifests, "— none yet —")}

        {text("BL / airway bill #", "blNumber", "TROP26070001", true)}
        {text("Container #", "containerNumber", "TCLU1234567", true)}
        {text("Container seal #", "containerSealNumber", "SEAL-100", true)}

        {enumSelect("Transport mode", "transportMode", TRANSPORT_MODES)}
        {text("Regime code", "regimeCode", "4", true)}
        {enumSelect("Goods type", "goodsType", GOODS_TYPES)}

        {enumSelect("Package type", "packageType", PACKAGE_TYPES)}
        {text("Package count", "packageCount", "1", true)}
        {text("Gross weight (lb)", "grossWeightLb", "0.000", true)}

        {text("Net weight (lb)", "netWeightLb", "0.000", true)}
        {text("Freight charge (BSD)", "freightCharge", "0.00", true)}
        <label style={field}>
          <span className="sb-eyebrow">Description</span>
          <input className="sb-inp" value={draft.description} onChange={set("description")} placeholder="Mixed consignment: …" />
        </label>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <button className="sb-btn" onClick={() => router.push("/shipments")} disabled={pending}>Cancel</button>
        <button className="sb-btn is-primary" onClick={submit} disabled={pending || !draft.clientId || !draft.declarationOfficeId}>
          {pending ? "Creating…" : "Create shipment"}
        </button>
      </div>
    </div>
  );
}
