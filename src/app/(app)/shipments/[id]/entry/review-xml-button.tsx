"use client";

import { useState, useTransition } from "react";
import { Icons } from "@/components/ui/icons";
import { generateReviewXml } from "@/lib/data/declaration-artifacts";
import type { ShipmentStatus } from "@/lib/types";
import { ApiClientError, apiRequest } from "@/lib/client-api";

interface GeneratedArtifact {
  id: string;
  groupCode: string;
  downloadUrl: string;
  fileName: string;
  attemptCount?: number;
  latestOutcome?: string | null;
  canCheckStatus?: boolean;
  responseDownloadUrl?: string | null;
  statusResponseDownloadUrl?: string | null;
}
interface SubmissionResult {
  outcome: string; attemptNumber: number; httpStatus: number | null;
  responsePayload: string | null; fault: { code: string | null; reason: string | null } | null;
  soapEnvelope?: string | null;
}
interface StatusResult extends SubmissionResult {
  originalMessageId: string;
  responseDownloadUrl?: string | null;
}

export function ReviewXmlButton({
  shipmentId,
  status,
  disabled = false,
  variant = "header",
  canSubmit = false,
  previewOnly = false,
  initialArtifacts = [],
}: {
  shipmentId: string;
  status: ShipmentStatus;
  disabled?: boolean;
  variant?: "header" | "ledger";
  canSubmit?: boolean;
  previewOnly?: boolean;
  initialArtifacts?: GeneratedArtifact[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<GeneratedArtifact[]>(initialArtifacts);
  const [responses, setResponses] = useState<Record<string, SubmissionResult>>({});
  const [statusResponses, setStatusResponses] = useState<Record<string, StatusResult>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [statusCheckingId, setStatusCheckingId] = useState<string | null>(null);
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

  async function checkSubmissionStatus(artifact: GeneratedArtifact) {
    setStatusCheckingId(artifact.id);
    setNotice(null);
    try {
      const response = await apiRequest<StatusResult>(`/api/customs-entries/${artifact.id}/status-check`, {
        method: "POST",
      });
      setStatusResponses((current) => ({ ...current, [artifact.id]: response }));
      if (response.responseDownloadUrl) {
        setArtifacts((current) => current.map((item) => item.id === artifact.id
          ? { ...item, statusResponseDownloadUrl: response.responseDownloadUrl }
          : item));
      }
      setNotice(response.outcome === "PREVIEW"
        ? `CPC ${artifact.groupCode}: status SOAP XML ready. Nothing was sent to Customs.`
        : `CPC ${artifact.groupCode}: status check ${response.outcome}${response.httpStatus ? ` (HTTP ${response.httpStatus})` : ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Status check failed.");
    } finally {
      setStatusCheckingId(null);
    }
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
      setArtifacts((current) => current.map((item) => item.id === artifact.id
        ? {
            ...item,
            latestOutcome: response.outcome,
            canCheckStatus: response.outcome === "ACKNOWLEDGED" || item.canCheckStatus,
            attemptCount: response.outcome === "PREVIEW" ? item.attemptCount : (item.attemptCount ?? 0) + 1,
            responseDownloadUrl: response.responsePayload
              ? `/api/customs-entries/${artifact.id}/response`
              : item.responseDownloadUrl,
          }
        : item));
      setNotice(response.outcome === "PREVIEW"
        ? `CPC ${artifact.groupCode}: full SOAP XML ready. Nothing was sent to Customs.`
        : `CPC ${artifact.groupCode}: ${response.outcome}${response.httpStatus ? ` (HTTP ${response.httpStatus})` : ""}.`);
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

  function downloadSoapPreview(artifact: GeneratedArtifact, envelope: string) {
    const url = URL.createObjectURL(new Blob([envelope], { type: "application/xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.fileName.replace(/\.xml$/i, "-soap-preview.xml");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const artifactControls = artifacts.length > 0 && (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      {artifacts.map((artifact) => (
        <div key={artifact.id} style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "inline-flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
            <a className="sb-btn is-sm" href={artifact.downloadUrl}>Review CPC {artifact.groupCode}</a>
            {artifact.responseDownloadUrl && (
              <a className="sb-btn is-sm" href={artifact.responseDownloadUrl}>Download acknowledgement</a>
            )}
            {artifact.statusResponseDownloadUrl && (
              <a className="sb-btn is-sm" href={artifact.statusResponseDownloadUrl}>Download latest status response</a>
            )}
            {(artifact.attemptCount ?? 0) > 0 && <span className="sb-meta">{artifact.attemptCount} attempt{artifact.attemptCount === 1 ? "" : "s"} · {artifact.latestOutcome}</span>}
            {canSubmit && <button className="sb-btn is-sm is-primary" type="button" disabled={submittingId !== null} onClick={() => void submitArtifact(artifact)}>
              {submittingId === artifact.id
                ? (previewOnly ? "Building preview…" : "Submitting…")
                : (previewOnly ? `Preview CPC ${artifact.groupCode} SOAP XML` : `Submit CPC ${artifact.groupCode} to QA`)}
            </button>}
            {canSubmit && artifact.canCheckStatus && (
              <button className="sb-btn is-sm" type="button" disabled={statusCheckingId !== null} onClick={() => void checkSubmissionStatus(artifact)}>
                {statusCheckingId === artifact.id ? "Checking…" : "Check submission status"}
              </button>
            )}
          </div>
          {responses[artifact.id]?.soapEnvelope && (
            <details open style={{ width: "min(760px, 90vw)" }}>
              <summary className="sb-meta">Full SOAP XML — not sent</summary>
              <p className="sb-meta" style={{ margin: "6px 0" }}>Private preview: this contains the configured QA username and password.</p>
              <button className="sb-btn is-sm" type="button" onClick={() => downloadSoapPreview(artifact, responses[artifact.id]!.soapEnvelope!)}>Download exact SOAP XML</button>
              <pre style={{ maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", marginTop: 8, padding: 10, border: "1px solid var(--sb-line)" }}>{responses[artifact.id].soapEnvelope}</pre>
            </details>
          )}
          {responses[artifact.id]?.responsePayload && (
            <details><summary className="sb-meta">Acknowledgement</summary><pre style={{ maxWidth: 620, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>{responses[artifact.id].responsePayload}</pre></details>
          )}
          {statusResponses[artifact.id]?.soapEnvelope && (
            <details open style={{ width: "min(760px, 90vw)" }}>
              <summary className="sb-meta">Status SOAP XML — not sent</summary>
              <p className="sb-meta" style={{ margin: "6px 0" }}>Original message ID: <span className="sb-mono">{statusResponses[artifact.id].originalMessageId}</span></p>
              <button className="sb-btn is-sm" type="button" onClick={() => downloadSoapPreview(artifact, statusResponses[artifact.id]!.soapEnvelope!)}>Download exact SOAP XML</button>
              <pre style={{ maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", marginTop: 8, padding: 10, border: "1px solid var(--sb-line)" }}>{statusResponses[artifact.id].soapEnvelope}</pre>
            </details>
          )}
          {statusResponses[artifact.id]?.responsePayload && (
            <details open><summary className="sb-meta">Secondary status response</summary><pre style={{ maxWidth: 760, maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}>{statusResponses[artifact.id].responsePayload}</pre></details>
          )}
        </div>
      ))}
    </div>
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
      <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {notice && <span className="sb-meta">{notice}</span>}
        <select className="sb-inp sb-mono" style={{ width: 88 }} value={declarationType} onChange={(e) => setDeclarationType(e.target.value as typeof declarationType)} aria-label="Declaration type">
          {["C13", "C14", "C17", "C18", "OTHER"].map((value) => <option key={value}>{value}</option>)}
        </select>
        {button}
        {artifactControls}
      </div>
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
