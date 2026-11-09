"use client";
import { useState } from "react";
import type { ColDef } from "ag-grid-community";
import { Grid, money } from "@/app/_components/Grid";
import { Panel } from "@/app/_components/ui";

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
  { field: "model", maxWidth: 150, cellStyle: (p) => (p.value === "rules" ? { color: "var(--pc-accent-ink)", fontWeight: 400 } : { color: "var(--pc-info)", fontWeight: 500 }) },
  { field: "input", maxWidth: 170 },
  { field: "output", headerName: "What it decided", minWidth: 360, tooltipField: "output" },
];

const tabClass = (on: boolean) => `rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${on ? "bg-brand-soft text-brand-dark" : "text-muted hover:text-ink"}`;

export function OpsGrids({ ledger, decisions }: { ledger: LedgerRow[]; decisions: DecisionRow[] }) {
  const [tab, setTab] = useState<"ledger" | "ai">("ledger");
  return (
    <Panel
      id="ledger"
      title={tab === "ledger" ? "Ledger" : "AI decisions"}
      description={tab === "ledger" ? "Every charge, fee, refund, commission and payout, as balanced debits and credits." : "Every AI decision with the model that made it, or rules when the fallback ran."}
      aside={
        <div className="flex gap-1 rounded-full border border-line p-1">
          <button type="button" className={tabClass(tab === "ledger")} aria-pressed={tab === "ledger"} onClick={() => setTab("ledger")}>
            Ledger <span className="num">{ledger.length}</span>
          </button>
          <button type="button" className={tabClass(tab === "ai")} aria-pressed={tab === "ai"} onClick={() => setTab("ai")}>
            AI decisions <span className="num">{decisions.length}</span>
          </button>
        </div>
      }
    >
      {tab === "ledger" ? <Grid rows={ledger} cols={ledgerCols} height={420} getRowId={(r) => r.id} /> : <Grid rows={decisions} cols={decisionCols} height={420} getRowId={(r) => r.id} />}
    </Panel>
  );
}
