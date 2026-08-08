"use client";

import { useState, useTransition } from "react";
import { Icons } from "@/components/ui/icons";
import { generateReviewXml } from "@/lib/data/declaration-artifacts";
import type { ShipmentStatus } from "@/lib/types";

export function ReviewXmlButton({
  shipmentId,
  status,
  disabled = false,
  variant = "header",
}: {
  shipmentId: string;
  status: ShipmentStatus;
  disabled?: boolean;
  variant?: "header" | "ledger";
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [declarationType, setDeclarationType] = useState<"C13" | "C14" | "C17" | "C18" | "OTHER">("C13");
  const [pending, startTransition] = useTransition();
  const enabled = status === "DRAFT" && !disabled;

  function generate() {
    if (!enabled || pending) return;
    setNotice(null);
    setIssues([]);
    startTransition(async () => {
      const result = await generateReviewXml(shipmentId, declarationType);
      if (result.error) {
        setNotice(result.error);
        setIssues(result.issues.map((issue) => `${issue.field}: ${issue.message}`));
        return;
      }
      setNotice(`Generated ${result.fileName}`);
      setIssues(result.warnings);
      if (result.downloadUrl) window.location.assign(result.downloadUrl);
    });
  }

  const label = pending ? "Generating…" : "Generate review XML";
  const button = (
    <button
      className={`sb-btn ${variant === "ledger" ? "is-gold" : "is-primary"}`}
      style={variant === "ledger" ? { width: "100%", justifyContent: "center" } : undefined}
      onClick={generate}
      disabled={!enabled || pending}
    >
      {label} {variant === "ledger" && status === "DRAFT" && <Icons.chevR />}
    </button>
  );

  if (variant === "header") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        {notice && <span className="sb-meta">{notice}</span>}
        <select className="sb-inp sb-mono" style={{ width: 88 }} value={declarationType} onChange={(e) => setDeclarationType(e.target.value as typeof declarationType)} aria-label="Declaration type">
          {["C13", "C14", "C17", "C18", "OTHER"].map((value) => <option key={value}>{value}</option>)}
        </select>
        {button}
      </span>
    );
  }

  return (
    <>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        <span className="sb-eyebrow">Declaration type</span>
        <select className="sb-inp" value={declarationType} onChange={(e) => setDeclarationType(e.target.value as typeof declarationType)}>
          <option value="C13">C13 — home consumption</option>
          <option value="C14">C14 — temporary import</option>
          <option value="C17">C17 — warehouse</option>
          <option value="C18">C18 — transshipment</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      {button}
      {notice && <div className="sb-meta" style={{ marginTop: 8 }}>{notice}</div>}
      {issues.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="sb-meta">Review {issues.length} validation note{issues.length === 1 ? "" : "s"}</summary>
          <ul className="sb-meta" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </details>
      )}
    </>
  );
}
