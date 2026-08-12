/**
 * Small formatting helpers used across the UI.
 * Pure functions, no dependencies — safe in both Server and Client Components.
 */

/** Join truthy class names. `cn("a", cond && "b")` -> "a b" */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

import Decimal from "decimal.js";

/** Format money without converting API decimal strings through a JS float. */
export function money(value: number | string): string {
  try {
    const fixed = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    const negative = fixed.startsWith("-");
    const [whole, cents] = (negative ? fixed.slice(1) : fixed).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}$${grouped}.${cents}`;
  } catch {
    return "$0.00";
  }
}

/** Format an ISO date (or Date) as "2026-05-18". */
export function isoDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 10);
}
