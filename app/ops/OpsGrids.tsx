"use client";
import { useState } from "react";
import type { ColDef } from "ag-grid-community";
import { Grid, money } from "@/app/_components/Grid";

type LedgerRow = { id: string; when: string; txn: string; account: string; seller: string; debit: number; credit: number; memo: string };
type DecisionRow = { id: string; when: string; agent: string; model: string; input: string; output: string };

const time = (p: { value: string }) => new Date(p.value).toLocaleString();

const ledgerCols: ColDef<LedgerRow>[] = [
  { field: "when", valueFormatter: time, maxWidth: 190, sort: "desc" },
  { field: "account", maxWidth: 160 },
  { field: "seller", maxWidth: 120 },
  { field: "debit", valueFormatter: (p) => (p.value ? money(p.value) : ""), maxWidth: 110, type: "numericColumn" },
  { field: "credit", valueFormatter: (p) => (p.value ? money(p.value) : ""), maxWidth: 110, type: "numericColumn" },
  { field: "memo", minWidth: 220 },
  { field: "txn", maxWidth: 150 },
];

const decisionCols: ColDef<DecisionRow>[] = [
  { field: "when", valueFormatter: time, maxWidth: 190, sort: "desc" },
  { field: "agent", maxWidth: 170, valueFormatter: (p) => String(p.value).replaceAll("_", " ") },
  { field: "model", maxWidth: 150, cellStyle: (p) => (p.value === "rules" ? { color: "#7d5a14", fontWeight: 400 } : { color: "#2f3a8f", fontWeight: 500 }) },
  { field: "input", maxWidth: 170 },
  { field: "output", headerName: "What it decided", minWidth: 360, tooltipField: "output" },
];

export function OpsGrids({ ledger, decisions }: { ledger: LedgerRow[]; decisions: DecisionRow[] }) {
  const [tab, setTab] = useState<"ledger" | "ai">("ledger");
  return (
    <section className="card p-5">
      <div className="mb-3 flex gap-2">
        <button className={`btn ${tab === "ledger" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("ledger")}>
          Ledger ({ledger.length})
        </button>
        <button className={`btn ${tab === "ai" ? "btn-primary" : "btn-ghost"}`} onClick={() => setTab("ai")}>
          AI decisions ({decisions.length})
        </button>
      </div>
      {tab === "ledger" ? <Grid rows={ledger} cols={ledgerCols} height={380} getRowId={(r) => r.id} /> : <Grid rows={decisions} cols={decisionCols} height={380} getRowId={(r) => r.id} />}
      <p className="mt-2 text-xs text-muted">
        {tab === "ledger" ? "Every PayPal charge, fee, refund, commission and payout writes balanced debit and credit rows." : "Every AI decision is kept with the model that made it, or 'rules' when the fallback ran."}
      </p>
    </section>
  );
}
