import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import type { ChipKind } from "@/lib/types";

/** Status chip. `kind` maps to a semantic color in theme.css. */
export function Chip({ kind = "draft", children }: { kind?: ChipKind; children: ReactNode }) {
  return <span className={cn("sb-chip", `is-${kind}`)}>{children}</span>;
}

type KpiTone = "neg" | "pos" | "gold" | "acc";

/** KPI stat card. Used on Home, Billing, Accounting, Clients. */
export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: KpiTone;
}) {
  const color =
    tone === "neg" ? "var(--sb-neg)" :
    tone === "pos" ? "var(--sb-pos)" :
    tone === "gold" ? "var(--sb-gold)" :
    tone === "acc" ? "var(--sb-accent)" : "var(--sb-ink)";
  return (
    <div className="sb-card sb-pad sb-kpi">
      <span className="sb-kpi-label">{label}</span>
      <span className="sb-kpi-val" style={{ color }}>{value}</span>
      {sub && <span className="sb-kpi-sub">{sub}</span>}
    </div>
  );
}
