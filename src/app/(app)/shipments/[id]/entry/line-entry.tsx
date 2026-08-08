"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Chip } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { money } from "@/lib/format";
import { previewLine } from "@/lib/calc";
import { commitLineItem, deleteLineItem, findHsRate, searchHsCodes } from "@/lib/data/line-items";
import { ReviewXmlButton } from "./review-xml-button";
import type { HsRate, InvoiceSummary, LineCharges, LineDraft, LineItem, ShipmentStatus, ShipmentTotals } from "@/lib/types";

/**
 * The interactive heart of the app.
 *
 * The split that matters: the ENTRY ROW previews duty/VAT/levy/excise locally
 * via previewLine() so typing feels instant, but a COMMITTED line always shows
 * the numbers the server's calculation engine returned. The preview is
 * deliberately simplified (no apportionment, no exemptions, no specific or
 * compound duty bases), so it is never persisted and never displayed as fact.
 *
 * Committing therefore does two server things: create the line, then reprice
 * the shipment. Both happen in one server action so the client gets back a
 * fully-priced line list rather than assembling one itself.
 */

/** Sum money strings in integer cents — floats drift once you add enough rows. */
function sumCents(values: string[]): number {
  return values.reduce((total, v) => total + Math.round(Number(v) * 100), 0);
}

const EMPTY_DRAFT: LineDraft = {
  invoiceId: "",
  hsCode: "",
  quantity: "1",
  unit: "PCS",
  description: "",
  cpcCode: "4000",
  unitPrice: "",
  countryOfOrigin: "",
  weightKg: "",
  netWeightKg: "",
  packageCount: "",
  packageTypeCode: "CT",
  unitsPerPackage: "",
  unitVolume: "",
  volumeUnit: "ML",
  alcoholStrength: "",
  alcoholStrengthBasis: "ABV_PERCENT",
};

export function LineEntry({
  shipmentId,
  status,
  hasInvoice,
  invoices,
  initialLines,
  initialTotals,
}: {
  shipmentId: string;
  status: ShipmentStatus;
  hasInvoice: boolean;
  invoices: InvoiceSummary[];
  initialLines: LineItem[];
  initialTotals: ShipmentTotals | null;
}) {
  // Entry is only meaningful on a DRAFT shipment with a supplier invoice; the
  // server refuses both cases anyway, so this just keeps the UI honest.
  const entryLocked = status !== "DRAFT" || !hasInvoice;
  const [lines, setLines] = useState<LineItem[]>(initialLines);
  const [totals, setTotals] = useState<ShipmentTotals | null>(initialTotals);
  const [draft, setDraft] = useState<LineDraft>({ ...EMPTY_DRAFT, invoiceId: invoices[0]?.id ?? "" });
  const [hsQuery, setHsQuery] = useState("");
  const [hits, setHits] = useState<HsRate[]>([]);
  const [draftRate, setDraftRate] = useState<HsRate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // HS search runs on the server (1,544 codes, pg_trgm index). Debounced so a
  // burst of keystrokes costs one query, not one per character.
  useEffect(() => {
    const query = hsQuery.trim();
    if (!query) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchHsCodes(query)
        .then((results) => {
          if (!cancelled) setHits(results);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hsQuery]);

  // Rates for the chosen code drive the entry row's live preview only.
  useEffect(() => {
    if (!draft.hsCode) {
      setDraftRate(null);
      return;
    }
    let cancelled = false;
    findHsRate(draft.hsCode)
      .then((rate) => {
        if (!cancelled) setDraftRate(rate);
      })
      .catch(() => {
        if (!cancelled) setDraftRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.hsCode]);

  const dc = previewLine(draft, draftRate);

  function commit() {
    if (!draft.invoiceId || !draft.hsCode || !draft.unitPrice || pending || entryLocked) return;
    const submitted = draft;
    setNotice(null);
    startTransition(async () => {
      try {
        // SERVER: create + reprice. The returned lines carry the engine's
        // numbers, which replace anything shown optimistically here.
        const result = await commitLineItem(shipmentId, submitted);
        setLines(result.lines);
        setTotals(result.totals);
        setNotice(result.error ?? result.calculationError);
        // Keep the draft on refusal so the broker's typing isn't thrown away.
        if (!result.error) {
          setDraft({ ...EMPTY_DRAFT, invoiceId: submitted.invoiceId });
          setHsQuery("");
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save the line");
      }
    });
  }

  function remove(id: string) {
    if (pending || entryLocked) return;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await deleteLineItem(shipmentId, id); // SERVER
        setLines(result.lines);
        setTotals(result.totals);
        setNotice(result.error ?? result.calculationError);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not delete the line");
      }
    });
  }

  /**
   * Column totals for the table footer — a sum of the SERVER's per-line
   * amounts, which is what those columns are. Deliberately NOT used for the
   * charges ledger: shipment-level items (processing fee, and the VAT charged
   * on that fee) belong to no line, so this sum is smaller than the amount
   * actually payable. The ledger uses `totals` from the engine instead.
   */
  const { columnTotals, unpriced } = useMemo(() => {
    const priced = lines.filter((l) => l.charges !== null);
    const pick = (key: keyof NonNullable<LineItem["charges"]>) =>
      sumCents(priced.map((l) => l.charges![key])) / 100;
    return {
      columnTotals: {
        fob: pick("fob"),
        duty: pick("duty"),
        excise: pick("excise"),
        levy: pick("levy"),
        vat: pick("vat"),
        payable: pick("payable"),
      } satisfies LineCharges,
      unpriced: lines.length - priced.length,
    };
  }, [lines]);

  const set = <K extends keyof LineDraft>(key: K, value: LineDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const assessmentUnits = [draftRate?.specificRateUnit, draftRate?.exciseSpecificRateUnit]
    .filter((unit): unit is string => Boolean(unit));
  const needsAlcoholMeasure = assessmentUnits.some((unit) => ["L", "IMP_GAL", "PROOF_GAL"].includes(unit));
  const formatRate = (rate: HsRate | null, charge: "duty" | "excise") => {
    if (!rate) return "—";
    const basis = charge === "duty" ? rate.dutyBasis : rate.exciseBasis;
    const adValorem = charge === "duty" ? rate.duty : rate.excise;
    const specific = charge === "duty" ? rate.specificRate : rate.exciseSpecificRate;
    const unit = charge === "duty" ? rate.specificRateUnit : rate.exciseSpecificRateUnit;
    if (basis === "NONE") return "none";
    if (basis === "AD_VALOREM") return `${Number(adValorem) * 100}%`;
    if (basis === "SPECIFIC") return `$${specific ?? "0"}/${unit ?? "unit"}`;
    const operator = basis === "ADDITIVE" ? " + " : " or ";
    return `${Number(adValorem) * 100}%${operator}$${specific ?? "0"}/${unit ?? "unit"}`;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18, alignItems: "start" }}>
      {/* ── main table ── */}
      <div className="sb-card" style={{ overflow: "hidden" }}>
        {notice && (
          <div style={{ padding: "9px 14px", background: "var(--sb-gold-soft)", borderBottom: "1px solid var(--sb-line)", fontSize: 12.5, color: "var(--sb-ink-2)" }}>
            {notice}
          </div>
        )}
        <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1.4fr .7fr .7fr .7fr .7fr .7fr", gap: 8, borderBottom: "1px solid var(--sb-line)", background: "var(--sb-surface-2)" }}>
          <label><span className="sb-eyebrow">Commercial invoice</span><select className="sb-inp" value={draft.invoiceId} onChange={(e) => set("invoiceId", e.target.value)}>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber} · {invoice.supplierName}</option>)}</select></label>
          <label><span className="sb-eyebrow">Commercial unit</span><input className="sb-inp sb-mono" value={draft.unit} onChange={(e) => set("unit", e.target.value.toUpperCase())} /></label>
          <label><span className="sb-eyebrow">Origin</span><input className="sb-inp sb-mono" maxLength={2} value={draft.countryOfOrigin} onChange={(e) => set("countryOfOrigin", e.target.value.toUpperCase())} placeholder="US" /></label>
          <label><span className="sb-eyebrow">Gross kg</span><input className="sb-inp sb-mono" value={draft.weightKg} onChange={(e) => set("weightKg", e.target.value)} /></label>
          <label><span className="sb-eyebrow">Net kg</span><input className="sb-inp sb-mono" value={draft.netWeightKg} onChange={(e) => set("netWeightKg", e.target.value)} /></label>
          <label><span className="sb-eyebrow">Packages / type</span><span style={{ display: "flex", gap: 4 }}><input className="sb-inp sb-mono" value={draft.packageCount} onChange={(e) => set("packageCount", e.target.value)} /><input className="sb-inp sb-mono" style={{ width: 48 }} value={draft.packageTypeCode} onChange={(e) => set("packageTypeCode", e.target.value.toUpperCase())} /></span></label>
        </div>
        {needsAlcoholMeasure && (
          <div style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, borderBottom: "1px solid var(--sb-line)", background: "var(--sb-gold-soft)" }}>
            <label><span className="sb-eyebrow">Units per package</span><input className="sb-inp sb-mono" value={draft.unitsPerPackage} onChange={(e) => set("unitsPerPackage", e.target.value)} placeholder="12" /></label>
            <label><span className="sb-eyebrow">Volume per unit</span><span style={{ display: "flex", gap: 4 }}><input className="sb-inp sb-mono" value={draft.unitVolume} onChange={(e) => set("unitVolume", e.target.value)} placeholder="750" /><select className="sb-inp" value={draft.volumeUnit} onChange={(e) => set("volumeUnit", e.target.value as LineDraft["volumeUnit"])}>{["ML", "CL", "L", "US_FL_OZ", "IMP_FL_OZ", "IMP_GAL"].map((unit) => <option key={unit}>{unit}</option>)}</select></span></label>
            <label><span className="sb-eyebrow">Alcohol strength</span><input className="sb-inp sb-mono" value={draft.alcoholStrength} onChange={(e) => set("alcoholStrength", e.target.value)} placeholder="40" /></label>
            <label><span className="sb-eyebrow">Strength basis</span><select className="sb-inp" value={draft.alcoholStrengthBasis} onChange={(e) => set("alcoholStrengthBasis", e.target.value as LineDraft["alcoholStrengthBasis"])}><option value="ABV_PERCENT">% ABV</option><option value="US_PROOF">US proof</option></select></label>
          </div>
        )}
        <table className="sb-tbl">
          <thead>
            <tr>
              <th style={{ width: 150 }}>HS code</th>
              <th style={{ width: 52 }}>CPC</th>
              <th style={{ width: 52 }}>Qty</th>
              <th>Description</th>
              <th className="sb-num" style={{ width: 78 }}>Value</th>
              <th className="sb-num" style={{ width: 90 }}>Duty</th>
              <th className="sb-num" style={{ width: 78 }}>Excise</th>
              <th className="sb-num" style={{ width: 82 }}>VAT</th>
              <th className="sb-num" style={{ width: 70 }}>Levy</th>
              <th className="sb-num" style={{ width: 88 }}>Payable</th>
              <th style={{ width: 34 }} />
            </tr>
          </thead>

          {/* live entry row — the ONLY place client-side preview numbers appear */}
          <tbody>
            <tr style={{ background: "#FFFCF3", borderTop: "2px solid var(--sb-gold)", borderBottom: "2px solid var(--sb-gold)" }}>
              <td style={{ verticalAlign: "top" }}>
                <div style={{ position: "relative" }}>
                  <input
                    className="sb-inp sb-mono"
                    style={{ padding: "5px 8px" }}
                    value={hsQuery || draft.hsCode}
                    onChange={(e) => setHsQuery(e.target.value)}
                    placeholder="search HS…"
                  />
                  {hsQuery && hits.length > 0 && (
                    <div className="sb-card" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, width: 340, marginTop: 4, boxShadow: "var(--sb-sh-2)", overflow: "hidden" }}>
                      {hits.map((h, i) => (
                        <div
                          key={h.code}
                          onClick={() => {
                            setDraft((current) => ({ ...current, hsCode: h.code, unit: h.unit ?? current.unit }));
                            setHsQuery("");
                          }}
                          style={{ padding: "7px 10px", cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline",
                            borderBottom: i < hits.length - 1 ? "1px solid var(--sb-line-2)" : "none",
                            background: i === 0 ? "var(--sb-accent-soft)" : "#fff" }}
                        >
                          <b className="sb-mono" style={{ fontSize: 12.5 }}>{h.code}</b>
                          <span style={{ flex: 1, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.description}</span>
                          <span className="sb-mono sb-meta">{formatRate(h, "duty")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sb-meta" style={{ marginTop: 4, maxWidth: 150, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {draftRate ? draftRate.description : "—"}
                </div>
                {draftRate && (
                  <div className="sb-meta" style={{ marginTop: 2, color: draftRate.isVerified ? "var(--sb-pos)" : "var(--sb-neg)" }}>
                    {draftRate.isVerified ? "verified" : "unverified"}{draftRate.sourceName ? ` · ${draftRate.sourceName}` : ""}{draftRate.sourcePage ? ` p.${draftRate.sourcePage}` : ""}
                  </div>
                )}
              </td>
              <td style={{ verticalAlign: "top" }}>
                <input className="sb-inp sb-mono" style={{ padding: "5px 6px", width: 46 }} value={draft.cpcCode} onChange={(e) => set("cpcCode", e.target.value)} />
              </td>
              <td style={{ verticalAlign: "top" }}>
                <input className="sb-inp sb-mono" style={{ padding: "5px 6px", width: 46, textAlign: "right" }} value={draft.quantity} onChange={(e) => set("quantity", e.target.value)} />
              </td>
              <td style={{ verticalAlign: "top" }}>
                <input className="sb-inp" style={{ padding: "5px 8px" }} value={draft.description} onChange={(e) => set("description", e.target.value)} placeholder="Item description…" />
              </td>
              <td style={{ verticalAlign: "top" }}>
                <input className="sb-inp sb-mono" style={{ padding: "5px 6px", width: 72, textAlign: "right" }} value={draft.unitPrice} onChange={(e) => set("unitPrice", e.target.value)} placeholder="0.00" />
              </td>
              <td className="sb-num" style={{ verticalAlign: "top", paddingTop: 11, color: "var(--sb-ink-2)" }}>
                <div className="sb-mono" style={{ fontSize: 11 }}>{formatRate(draftRate, "duty")}</div>
                <div className="sb-mono" style={{ fontSize: 12.5 }}>{money(dc.duty)}</div>
              </td>
              <td className="sb-num" style={{ verticalAlign: "top", paddingTop: 11, color: dc.excise > 0 ? "var(--sb-excise)" : "var(--sb-ink-3)" }}>
                <div className="sb-mono" style={{ fontSize: 11 }}>{formatRate(draftRate, "excise")}</div>
                <div className="sb-mono" style={{ fontSize: 12.5 }}>{money(dc.excise)}</div>
              </td>
              <td className="sb-num" style={{ verticalAlign: "top", paddingTop: 11, color: "var(--sb-ink-2)" }}>
                <div className="sb-mono" style={{ fontSize: 12 }}>{draftRate ? Math.round(Number(draftRate.vat) * 100) + "%" : "—"}</div>
                <div className="sb-mono" style={{ fontSize: 12.5 }}>{money(dc.vat)}</div>
              </td>
              <td className="sb-num" style={{ verticalAlign: "top", paddingTop: 11, color: "var(--sb-ink-2)" }}>
                <div className="sb-mono" style={{ fontSize: 12.5 }}>{money(dc.levy)}</div>
              </td>
              <td className="sb-num" style={{ verticalAlign: "top", paddingTop: 11 }}>
                <b className="sb-mono" style={{ color: "var(--sb-marine)" }}>{money(dc.payable)}</b>
                <div className="sb-meta" style={{ fontSize: 10.5 }}>preview</div>
              </td>
              <td style={{ verticalAlign: "top", paddingTop: 8 }}>
                <button className="sb-btn is-primary is-sm" style={{ padding: "4px 8px" }} onClick={commit} disabled={pending || entryLocked} title="Commit line (Enter)">↵</button>
              </td>
            </tr>
          </tbody>

          {/* committed lines — server numbers only */}
          <tbody>
            {lines.map((l) => {
              const c = l.charges;
              const isExcise = c !== null && Number(c.excise) > 0;
              const dutyPct = l.rates ? Math.round(Number(l.rates.duty) * 100) : 0;
              const vatPct = l.rates ? Math.round(Number(l.rates.vat) * 100) : 0;
              return (
                <tr key={l.id} style={{ opacity: pending ? 0.6 : 1 }}>
                  <td style={{ verticalAlign: "top" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <b className="sb-mono">{l.hsCode}</b>
                      {isExcise && <Chip kind="excise">excise</Chip>}
                    </div>
                    <div className="sb-meta" style={{ marginTop: 2, maxWidth: 140, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {l.hsDescription ?? "—"}
                    </div>
                  </td>
                  <td className="sb-mono" style={{ verticalAlign: "top" }}>{l.cpcCode}</td>
                  <td className="sb-mono" style={{ verticalAlign: "top", textAlign: "right" }}>
                    {l.quantity}<span className="sb-soft"> {l.unit}</span>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <div>{l.description}</div>
                    <div className="sb-meta">Invoice {l.invoiceNumber}</div>
                    {l.pageNumber !== null && <div className="sb-meta">p. {l.pageNumber}</div>}
                  </td>
                  {c === null ? (
                    <>
                      <td className="sb-num" style={{ verticalAlign: "top" }}>{money(l.totalValue)}</td>
                      <td className="sb-num sb-meta" colSpan={4} style={{ verticalAlign: "top", textAlign: "center" }}>
                        not yet calculated
                      </td>
                      <td className="sb-num sb-meta" style={{ verticalAlign: "top" }}>—</td>
                    </>
                  ) : (
                    <>
                      <td className="sb-num" style={{ verticalAlign: "top" }}>{money(c.cif)}</td>
                      <td className="sb-num" style={{ verticalAlign: "top", background: isExcise ? "var(--sb-excise-soft)" : "transparent" }}>
                        <div className="sb-mono" style={{ fontSize: 12, color: "var(--sb-ink-3)" }}>{dutyPct}%</div>
                        <div className="sb-mono">{money(c.duty)}</div>
                      </td>
                      <td className="sb-num" style={{ verticalAlign: "top", color: isExcise ? "var(--sb-excise)" : "var(--sb-ink-3)" }}>{money(c.excise)}</td>
                      <td className="sb-num" style={{ verticalAlign: "top" }}>
                        <div className="sb-mono" style={{ fontSize: 12, color: "var(--sb-ink-3)" }}>{vatPct}%</div>
                        <div className="sb-mono">{money(c.vat)}</div>
                      </td>
                      <td className="sb-num" style={{ verticalAlign: "top" }}>{money(c.levy)}</td>
                      <td className="sb-num" style={{ verticalAlign: "top" }}><b className="sb-mono">{money(c.payable)}</b></td>
                    </>
                  )}
                  <td style={{ verticalAlign: "top" }}>
                    <button className="sb-iconbtn" style={{ width: 24, height: 24, color: "var(--sb-ink-3)" }} onClick={() => remove(l.id)} disabled={pending} aria-label="Delete line">
                      <Icons.trash />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr style={{ borderTop: "2px solid var(--sb-line)", background: "var(--sb-surface-2)" }}>
              <td colSpan={4} style={{ padding: "11px 12px" }}>
                <span className="sb-h2">Line totals</span>{' '}
                <span className="sb-meta">{lines.length} lines · excludes processing fee and its VAT</span>
              </td>
              <td className="sb-num sb-strong sb-mono">{money(columnTotals.fob)}</td>
              <td className="sb-num sb-strong sb-mono">{money(columnTotals.duty)}</td>
              <td className="sb-num sb-strong sb-mono" style={{ color: columnTotals.excise > 0 ? "var(--sb-excise)" : "inherit" }}>{money(columnTotals.excise)}</td>
              <td className="sb-num sb-strong sb-mono">{money(columnTotals.vat)}</td>
              <td className="sb-num sb-strong sb-mono">{money(columnTotals.levy)}</td>
              <td className="sb-num"><b className="sb-mono" style={{ color: "var(--sb-marine)" }}>{money(columnTotals.payable)}</b></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── live charges ledger (signature element) ── */}
      <div className="sb-card" style={{ position: "sticky", top: 14, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", background: "var(--sb-marine)", color: "#EAF1F3" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Declaration charges</div>
          <div style={{ fontSize: 12, color: "#9FC0C8" }}>Calculated by the customs engine</div>
        </div>
        <div className="sb-pad" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {([
            ["Customs value (CIF)", totals?.cif, false],
            ["Duty", totals?.duty, false],
            ["Excise", totals?.excise, Number(totals?.excise ?? 0) > 0],
            ["Environmental levy", totals?.levy, false],
            ["VAT", totals?.vat, false],
            ["Processing fee", totals?.processingFee, false],
          ] as [string, string | undefined, boolean][]).map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5px 0", borderBottom: "1px dashed var(--sb-line-2)" }}>
              <span className="sb-soft" style={{ color: r[2] ? "var(--sb-excise)" : undefined, fontWeight: r[2] ? 600 : 400 }}>{r[0]}</span>
              <span className="sb-mono" style={{ color: r[2] ? "var(--sb-excise)" : undefined }}>{r[1] === undefined ? "—" : money(r[1])}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 0 4px", marginTop: 4 }}>
            <span className="sb-cond" style={{ fontSize: 17, fontWeight: 700 }}>Total payable</span>
            <span className="sb-mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--sb-marine)" }}>
              {totals ? money(totals.payable) : "—"}
            </span>
          </div>
          <div className="sb-meta" style={{ marginBottom: 10 }}>
            {totals === null
              ? "Not yet calculated — commit a line to price this shipment"
              : unpriced > 0
                ? `${unpriced} line${unpriced === 1 ? "" : "s"} added since the last calculation`
                : "Duty + excise + levy + VAT + processing fee"}
          </div>
          <ReviewXmlButton
            shipmentId={shipmentId}
            status={status}
            disabled={totals === null}
            variant="ledger"
          />
          <div className="sb-meta" style={{ textAlign: "center", marginTop: 8 }}>
            <Chip kind="excise">excise</Chip> flags alcohol, fuel &amp; tobacco
          </div>
        </div>
      </div>
    </div>
  );
}
