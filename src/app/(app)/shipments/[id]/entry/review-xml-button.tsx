"use client";

import { useState, useTransition } from "react";
import { Icons } from "@/components/ui/icons";
import { generateReviewXml } from "@/lib/data/declaration-artifacts";
import type { ShipmentStatus } from "@/lib/types";
import { ApiClientError, apiRequest } from "@/lib/client-api";

interface GeneratedArtifact { id: string; groupCode: string; downloadUrl: string; fileName: string; attemptCount?: number; latestOutcome?: string | null }
interface SubmissionResult {
  outcome: string; attemptNumber: number; httpStatus: number | null;
  responsePayload: string | null; fault: { code: string | null; reason: string | null } | null;
}

export function ReviewXmlButton({
  shipmentId,
  status,
  disabled = false,
  variant = "header",
  canSubmit = false,
  initialArtifacts = [],
}: {
  shipmentId: string;
  status: ShipmentStatus;
  disabled?: boolean;
  variant?: "header" | "ledger";
  canSubmit?: boolean;
  initialArtifacts?: GeneratedArtifact[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[]>(initialArtifacts);
  const [responses, setResponses] = useState<Record<string, SubmissionResult>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [declarationType, setDeclarationType] = useState<"C13" | "C14" | "C17" | "C18" | "OTHER">("C13");
  const [pending, startTransition] = useTransition();
  const enabled = status === "DRAFT" && !disabled;

  function generate() {
    if (!enabled || pending) return;
    setNotice(null);
    setIssues([]);
    setArtifacts([]);
    startTransition(async () => {
      const result = await generateReviewXml(shipmentId, declarationType);
      if (result.error) {
        setNotice(result.error);
        setIssues(result.issues.map((issue) => `${issue.field}: ${issue.message}`));
        return;
      }
      setArtifacts(result.artifacts);
      setNotice(`Generated ${result.artifacts.length} declaration artifact${result.artifacts.length === 1 ? "" : "s"}. Review before submitting.`);
      setIssues(result.warnings);
    });
  }

  async function submitArtifact(artifact: GeneratedArtifact, confirmResubmission = false) {
    setSubmittingId(artifact.id);
    setNotice(null);
    try {
      const response = await apiRequest<SubmissionResult>(`/api/customs-entries/${artifact.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ confirmResubmission, ...(confirmResubmission ? { resubmissionReason: "Broker explicitly confirmed repeat QA submission" } : {}) }),
      });
      setResponses((current) => ({ ...current, [artifact.id]: response }));
      setNotice(`CPC ${artifact.groupCode}: ${response.outcome}${response.httpStatus ? ` (HTTP ${response.httpStatus})` : ""}.`);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        const confirmed = window.confirm("This declaration has already been submitted. Submit it again? This may create another government record.");
        if (confirmed) return void submitArtifact(artifact, true);
      }
      setNotice(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setSubmittingId(null);
    }
  }

  const artifactControls = artifacts.length > 0 && (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {artifacts.map((artifact) => (
        <span key={artifact.id} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
          <a className="sb-btn is-sm" href={artifact.downloadUrl}>Review CPC {artifact.groupCode}</a>
          {(artifact.attemptCount ?? 0) > 0 && <span className="sb-meta">{artifact.attemptCount} attempt{artifact.attemptCount === 1 ? "" : "s"} · {artifact.latestOutcome}</span>}
          {canSubmit && <button className="sb-btn is-sm is-primary" type="button" disabled={submittingId !== null} onClick={() => void submitArtifact(artifact)}>
            {submittingId === artifact.id ? "Submitting…" : `Submit CPC ${artifact.groupCode} to QA`}
          </button>}
          {responses[artifact.id]?.responsePayload && (
            <details><summary className="sb-meta">Response</summary><pre style={{ maxWidth: 620, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>{responses[artifact.id].responsePayload}</pre></details>
          )}
        </span>
      ))}
    </span>
  );

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
        {artifactControls}
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
      <div style={{ marginTop: 8 }}>{artifactControls}</div>
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
