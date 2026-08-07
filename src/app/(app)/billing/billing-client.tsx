"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Chip } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { cn, money } from "@/lib/format";
import type { BillingDoc, BillingKind, BillingStatus, ClientOption } from "@/lib/data/billing";
import {
  createBrokerageDoc,
  sendBrokerageDoc,
  convertQuote,
  type DocDraft,
} from "@/lib/data/billing-actions";
import type { ChipKind } from "@/lib/types";

const STATUS: Record<BillingStatus, { kind: ChipKind; label: string }> = {
  DRAFT:          { kind: "draft", label: "Draft" },
  SENT:           { kind: "acc",   label: "Sent" },
  PARTIALLY_PAID: { kind: "gold",  label: "Part-paid" },
  PAID:           { kind: "pos",   label: "Paid" },
  VOID:           { kind: "neg",   label: "Void" },
};

type TabId = "all" | "INVOICE" | "QUOTE";
const TABS: { id: TabId; label: string }[] = [
  { id: "all",     label: "All" },
  { id: "INVOICE", label: "Invoices" },
  { id: "QUOTE",   label: "Quotes" },
];

type LineDraft = { description: string; quantity: string; unitPrice: string };
const emptyLine = (): LineDraft => ({ description: "", quantity: "1", unitPrice: "" });

export function BillingClient({
  docs,
  clients,
}: {
  docs: BillingDoc[];
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [formKind, setFormKind] = useState<BillingKind | null>(null);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length, INVOICE: 0, QUOTE: 0 };
    for (const d of docs) c[d.kind] = (c[d.kind] || 0) + 1;
    return c;
  }, [docs]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return docs.filter(
      (d) =>
        (tab === "all" || d.kind === tab) &&
        (!q || (d.number + d.clientName).toLowerCase().includes(q))
    );
  }, [docs, tab, query]);

  function send(id: string) {
    if (pending) return;
    setNotice(null);
    startTransition(async () => {
      const r = await sendBrokerageDoc(id);
      if (r.error) setNotice(r.error);
      else router.refresh();
    });
  }

  function convert(doc: BillingDoc) {
    if (pending) return;
    const number = window.prompt(
      `New invoice number for the invoice converted from quote ${doc.number}:`
    );
    if (!number) return;
    setNotice(null);
    startTransition(async () => {
      const r = await convertQuote(doc.id, number);
      if (r.error) setNotice(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="sb-page">
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 16 }}>
        <h1 className="sb-h1">Billing</h1>
        <span className="sb-meta">
          {counts.INVOICE ?? 0} invoices · {counts.QUOTE ?? 0} quotes
        </span>
        <div style={{ flex: 1 }} />
        <button
          className="sb-btn"
          onClick={() => { setFormKind(formKind === "QUOTE" ? null : "QUOTE"); setNotice(null); }}
        >
          <Icons.plus /> New quote
        </button>
        <button
          className="sb-btn is-primary"
          onClick={() => { setFormKind(formKind === "INVOICE" ? null : "INVOICE"); setNotice(null); }}
        >
          <Icons.plus /> New invoice
        </button>
      </div>

      {notice && (
        <div style={{ padding: "8px 12px", marginBottom: 12, background: "var(--sb-gold-soft)", borderRadius: 6, fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      {formKind && (
        <CreateForm
          kind={formKind}
          clients={clients}
          pending={pending}
          onCancel={() => setFormKind(null)}
          onSubmit={(draft) => {
            setNotice(null);
            startTransition(async () => {
              const r = await createBrokerageDoc(draft);
              if (r.error) setNotice(r.error);
              else { setFormKind(null); router.refresh(); }
            });
          }}
        />
      )}

      <div className="sb-stabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={cn("sb-stab", tab === t.id && "is-active")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="sb-count">{counts[t.id] ?? 0}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div className="sb-search" style={{ margin: "3px 0" }}>
          <Icons.search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search number, client…"
          />
        </div>
      </div>

      <div className="sb-card" style={{ overflow: "hidden", marginTop: 14 }}>
        <table className="sb-tbl">
          <thead>
            <tr>
              <th>Number</th>
              <th>Type</th>
              <th>Client</th>
              <th>Issued</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Paid</th>
              <th>Status</th>
              <th style={{ width: 150 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const st = STATUS[d.status] ?? STATUS.DRAFT;
              return (
                <tr key={d.id}>
                  <td className="sb-mono">{d.number}</td>
                  <td>
                    <Chip kind={d.kind === "QUOTE" ? "gold" : "acc"}>
                      {d.kind === "QUOTE" ? "Quote" : "Invoice"}
                    </Chip>
                  </td>
                  <td>{d.clientName}</td>
                  <td className="sb-mono">{d.issueDate}</td>
                  <td className="sb-mono" style={{ textAlign: "right" }}>{money(d.total)}</td>
                  <td className="sb-mono sb-soft" style={{ textAlign: "right" }}>
                    {d.kind === "QUOTE" ? "—" : money(d.amountPaid)}
                  </td>
                  <td>
                    <Chip kind={st.kind}>{st.label}</Chip>
                    {d.convertedToNumber && (
                      <span className="sb-meta" style={{ marginLeft: 6 }}>→ {d.convertedToNumber}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      {d.status === "DRAFT" && (
                        <button className="sb-btn" style={{ padding: "4px 10px" }} disabled={pending} onClick={() => send(d.id)}>
                          Send
                        </button>
                      )}
                      {d.kind === "QUOTE" && !d.convertedToNumber && (
                        <button className="sb-btn is-primary" style={{ padding: "4px 10px" }} disabled={pending} onClick={() => convert(d)}>
                          Convert
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="sb-meta" style={{ textAlign: "center", padding: 24, fontStyle: "italic" }}>
                  Nothing here yet. Create an invoice or a quote to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="sb-meta" style={{ textAlign: "right", padding: "10px 4px" }}>
        {filtered.length} of {docs.length} documents
      </div>
    </div>
  );
}

function CreateForm({
  kind,
  clients,
  pending,
  onSubmit,
  onCancel,
}: {
  kind: BillingKind;
  clients: ClientOption[];
  pending: boolean;
  onSubmit: (draft: DocDraft) => void;
  onCancel: () => void;
}) {
  const isQuote = kind === "QUOTE";
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [number, setNumber] = useState("");
  const [dateField, setDateField] = useState("");
  const [vatRate, setVatRate] = useState("0.10");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const total = useMemo(() => {
    const sub = lines.reduce((acc, l) => {
      const q = Number(l.quantity) || 0;
      const p = Number(l.unitPrice) || 0;
      return acc + q * p;
    }, 0);
    const vat = sub * (Number(vatRate) || 0);
    return { sub, vat, grand: sub + vat };
  }, [lines, vatRate]);

  const field = { display: "flex", flexDirection: "column" as const, gap: 4 };
  const canSubmit =
    !pending && clientId && number.trim() && lines.some((l) => l.description.trim() && l.unitPrice.trim());

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      kind,
      clientId,
      number,
      dueDate: isQuote ? "" : dateField,
      validUntil: isQuote ? dateField : "",
      vatRate,
      notes,
      items: lines,
    });
  }

  return (
    <div
      className="sb-card sb-pad"
      style={{ margin: "0 0 16px", borderLeft: `3px solid ${isQuote ? "var(--sb-gold)" : "var(--sb-accent)"}` }}
    >
      <div style={{ marginBottom: 12 }}>
        <div className="sb-h2">{isQuote ? "New quote (estimate)" : "New invoice"}</div>
        <div className="sb-meta">
          {isQuote
            ? "A non-binding proforma. Convert it to an invoice once the client accepts."
            : "Billable document. Send it, then record payments against it."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 0.8fr", gap: 12, marginBottom: 12 }}>
        <label style={field}>
          <span className="sb-eyebrow">Client</span>
          <select className="sb-inp" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.length === 0 && <option value="">No clients — add one first</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label style={field}>
          <span className="sb-eyebrow">{isQuote ? "Quote #" : "Invoice #"}</span>
          <input
            className="sb-inp sb-mono"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder={isQuote ? "QUO-1001" : "INV-1001"}
          />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">{isQuote ? "Valid until" : "Due date"}</span>
          <input className="sb-inp sb-mono" type="date" value={dateField} onChange={(e) => setDateField(e.target.value)} />
        </label>
        <label style={field}>
          <span className="sb-eyebrow">VAT rate</span>
          <input
            className="sb-inp sb-mono"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            placeholder="0.10"
          />
        </label>
      </div>

      <div className="sb-eyebrow" style={{ marginBottom: 6 }}>Line items</div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "2.4fr 0.7fr 0.9fr auto", gap: 10, marginBottom: 8, alignItems: "center" }}>
          <input
            className="sb-inp"
            value={l.description}
            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
            placeholder="Customs clearance, delivery, storage…"
          />
          <input
            className="sb-inp sb-mono"
            value={l.quantity}
            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
            placeholder="1"
          />
          <input
            className="sb-inp sb-mono"
            value={l.unitPrice}
            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))}
            placeholder="0.00"
          />
          <button
            className="sb-iconbtn"
            aria-label="Remove line"
            style={{ width: 30, height: 30, color: "var(--sb-ink-3)" }}
            disabled={lines.length === 1}
            onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
          >
            <Icons.trash />
          </button>
        </div>
      ))}
      <button className="sb-btn" style={{ padding: "4px 10px", marginTop: 2 }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
        <Icons.plus /> Add line
      </button>

      <label style={{ ...field, marginTop: 12 }}>
        <span className="sb-eyebrow">Notes (optional)</span>
        <input className="sb-inp" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, references…" />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 16 }}>
        <div className="sb-meta">
          Subtotal <b className="sb-mono">{money(total.sub)}</b> · VAT <b className="sb-mono">{money(total.vat)}</b> · Total{" "}
          <b className="sb-mono">{money(total.grand)}</b>
          <span style={{ marginLeft: 6 }}>(server recomputes on save)</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="sb-btn" onClick={onCancel} disabled={pending}>Cancel</button>
        <button className="sb-btn is-primary" onClick={submit} disabled={!canSubmit}>
          {pending ? "Saving…" : isQuote ? "Create quote" : "Create invoice"}
        </button>
      </div>
    </div>
  );
}
