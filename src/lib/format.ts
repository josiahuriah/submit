/**
 * Small formatting helpers used across the UI.
 * Pure functions, no dependencies — safe in both Server and Client Components.
 */

/** Join truthy class names. `cn("a", cond && "b")` -> "a b" */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Format a number as USD money. Accepts a number or a numeric string
 * (your API returns money as strings to preserve precision — this handles both).
 */
export function money(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  return "$" + (Number.isFinite(n) ? n : 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format an ISO date (or Date) as "2026-05-18". */
export function isoDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}
