"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icons } from "@/components/ui/icons";
import { submitShipment } from "@/lib/data/shipment-actions";
import type { ShipmentStatus } from "@/lib/types";

/**
 * The wired "submit to customs" control — used in the page header and (in its
 * `variant="ledger"` form) at the foot of the charges ledger. Both drive the
 * same Server Action: declarationsService.submit → BEAIP (mock or production
 * per BEAIP_MODE). Refusals (not DRAFT, stale calculation, missing role) come
 * back as data and render inline; success refreshes the route so the server
 * re-renders the SUBMITTED state.
 */
export function SubmitButton({
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
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submittable = status === "DRAFT" && !disabled;

  function submit() {
    if (pending || !submittable) return;
    setNotice(null);
    startTransition(async () => {
      const result = await submitShipment(shipmentId); // SERVER
      if (result.error) {
        setNotice(result.error);
        return;
      }
      setNotice(
        result.outcome === "REJECTED"
          ? `Rejected: ${result.message}`
          : result.message ?? "Declaration submitted",
      );
      router.refresh();
    });
  }

  const label = pending
    ? "Submitting…"
    : status === "DRAFT"
      ? variant === "ledger"
        ? "Submit declaration"
        : "Submit to customs"
      : status === "SUBMITTED"
        ? "Submitted"
        : status;

  if (variant === "ledger") {
    return (
      <>
        <button
          className="sb-btn is-gold"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={submit}
          disabled={pending || !submittable}
        >
          {label} {status === "DRAFT" && <Icons.chevR />}
        </button>
        {notice && (
          <div className="sb-meta" style={{ textAlign: "center", marginTop: 8 }}>{notice}</div>
        )}
      </>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      {notice && <span className="sb-meta">{notice}</span>}
      <button className="sb-btn is-gold" onClick={submit} disabled={pending || !submittable}>
        {label}
      </button>
    </span>
  );
}
