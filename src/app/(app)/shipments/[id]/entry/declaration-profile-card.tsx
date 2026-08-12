"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDeclarationProfile } from "@/lib/data/declaration-profile";
import type { DeclarationProfile } from "@/lib/types";

export function DeclarationProfileCard({ shipmentId, initial }: { shipmentId: string; initial: DeclarationProfile }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof DeclarationProfile>(key: K, value: DeclarationProfile[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };

  function save() {
    setNotice(null);
    startTransition(async () => {
      const { canManageOrganization, ...input } = draft;
      void canManageOrganization;
      const result = await updateDeclarationProfile(shipmentId, input);
      setNotice(result.error ?? result.calculationNotice ?? "Declaration profile saved.");
      if (!result.error) router.refresh();
    });
  }

  return (
    <details className="sb-card" open style={{ margin: "14px 0" }}>
      <summary style={{ padding: "12px 16px", cursor: "pointer", fontWeight: 650, borderBottom: "1px solid var(--sb-line)" }}>
        Declaration profile <span className="sb-meta">— TFP header and consignment fields</span>
      </summary>
      <div className="sb-pad" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(130px, 1fr))", gap: 12 }}>
        <label style={{ ...field, gridColumn: "span 2" }}><span className="sb-eyebrow">Company Registration Number</span><input className="sb-inp sb-mono" value={draft.companyRegistrationNumber} disabled={!draft.canManageOrganization} onChange={(e) => set("companyRegistrationNumber", e.target.value)} /><span className="sb-meta">TFP Submitter/ID. {draft.canManageOrganization ? "Owner-managed." : "An owner must change this organization identifier."}</span></label>
        <label style={field}><span className="sb-eyebrow">Declaration date</span><input type="date" className="sb-inp sb-mono" value={draft.declarationDate} onChange={(e) => set("declarationDate", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Function</span><select className="sb-inp" value={draft.declarationFunctionCode} onChange={(e) => set("declarationFunctionCode", e.target.value as DeclarationProfile["declarationFunctionCode"])}><option value="9">9 — original</option><option value="5">5 — amendment</option><option value="1">1 — cancellation</option></select></label>
        <label style={field}><span className="sb-eyebrow">Regime code</span><input className="sb-inp sb-mono" value={draft.regimeCode} onChange={(e) => set("regimeCode", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">B/L or airway bill</span><input className="sb-inp sb-mono" value={draft.blNumber} onChange={(e) => set("blNumber", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Container</span><input className="sb-inp sb-mono" value={draft.containerNumber} onChange={(e) => set("containerNumber", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Seal</span><input className="sb-inp sb-mono" value={draft.containerSealNumber} onChange={(e) => set("containerSealNumber", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Fullness code</span><input className="sb-inp sb-mono" value={draft.containerFullnessCode} onChange={(e) => set("containerFullnessCode", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Transport nationality</span><input className="sb-inp sb-mono" maxLength={2} value={draft.transportNationalityCode} onChange={(e) => set("transportNationalityCode", e.target.value.toUpperCase())} placeholder="BS" /></label>
        <label style={field}><span className="sb-eyebrow">Goods location</span><input className="sb-inp sb-mono" value={draft.goodsLocationCode} onChange={(e) => set("goodsLocationCode", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Warehouse</span><input className="sb-inp sb-mono" value={draft.warehouseCode} onChange={(e) => set("warehouseCode", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Packages</span><input className="sb-inp sb-mono" value={draft.packageCount} onChange={(e) => set("packageCount", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Package type</span><select className="sb-inp" value={draft.packageType} onChange={(e) => set("packageType", e.target.value as DeclarationProfile["packageType"])}>{["CONTAINER", "PALLET", "CARTON", "CRATE", "DRUM", "BUNDLE", "LOOSE", "VEHICLE", "OTHER"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label style={field}><span className="sb-eyebrow">Gross kg</span><input className="sb-inp sb-mono" value={draft.grossWeightKg} onChange={(e) => set("grossWeightKg", e.target.value)} /></label>
        <label style={field}><span className="sb-eyebrow">Net kg</span><input className="sb-inp sb-mono" value={draft.netWeightKg} onChange={(e) => set("netWeightKg", e.target.value)} /></label>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {notice && <span className="sb-meta">{notice}</span>}
          <button className="sb-btn is-primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save declaration profile"}</button>
        </div>
      </div>
    </details>
  );
}
