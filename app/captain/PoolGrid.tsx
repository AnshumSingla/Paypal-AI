"use client";
import type { ColDef } from "ag-grid-community";
import { Grid, money } from "@/app/_components/Grid";

type Row = { id: string; product: string; pack: string; status: string; demand: number; bids: number; seller: string; trust: number | null; moq: number | null; committed: number; unit: number | null; nextNeeded: number | null; nextUnit: number | null; retail: number; savings: number | null; note: string };

export const POOL_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  OPEN_FOR_BIDS: { label: "Open for bids", bg: "#eef0f8", fg: "#2f3a8f" },
  PRICED: { label: "Taking orders", bg: "#f8f2e4", fg: "#7d5a14" },
  SUCCEEDED: { label: "Ordered", bg: "#e9f3ee", fg: "#2e6b52" },
  DELIVERED: { label: "Delivered", bg: "#e9f3ee", fg: "#2e6b52" },
  FAILED: { label: "Missed minimum", bg: "#fbedeb", fg: "#b4443a" },
  NO_BID: { label: "No bids", bg: "#fbedeb", fg: "#b4443a" },
};

function StatusCell({ value }: { value: string }) {
  const st = POOL_STATUS[value] ?? { label: value, bg: "#efeff0", fg: "#6b6f78" };
  return <span style={{ padding: "2px 9px", borderRadius: 99, fontSize: 12, fontWeight: 500, background: st.bg, color: st.fg }}>{st.label}</span>;
}

/** How close the building is to the next cheaper price, as a small bar inside the cell. */
function NextPriceCell({ data }: { data?: Row }) {
  if (!data || data.nextNeeded == null || data.nextUnit == null) return data?.unit ? <span style={{ color: "#2e6b52" }}>Best price reached</span> : null;
  const target = data.committed + data.nextNeeded;
  const pct = Math.round((data.committed / target) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: "100%" }}>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: "#efeff0", overflow: "hidden", minWidth: 48 }}>
        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 99, background: "var(--pc-brand)", transition: "width 600ms ease-out" }} />
      </div>
      <span style={{ whiteSpace: "nowrap" }}>
        {data.nextNeeded} more for {money(data.nextUnit)}
      </span>
    </div>
  );
}

const cols: ColDef<Row>[] = [
  { field: "product", headerName: "Pool", minWidth: 200, pinned: "left" },
  { field: "pack", headerName: "Pack", maxWidth: 110 },
  { field: "status", maxWidth: 150, cellRenderer: StatusCell },
  { field: "demand", headerName: "Wanted", maxWidth: 100, type: "numericColumn" },
  { field: "bids", maxWidth: 80, type: "numericColumn" },
  { field: "seller", headerName: "Supplier", minWidth: 160 },
  { field: "trust", headerName: "Trust", maxWidth: 90, type: "numericColumn", valueFormatter: (p) => (p.value == null ? "" : `${p.value}/100`) },
  { field: "committed", headerName: "Held", maxWidth: 90, type: "numericColumn", enableCellChangeFlash: true },
  { field: "unit", headerName: "Price now", maxWidth: 110, valueFormatter: (p) => money(p.value), type: "numericColumn", enableCellChangeFlash: true },
  { colId: "next", headerName: "Next price", minWidth: 210, cellRenderer: NextPriceCell, sortable: false, filter: false },
  { field: "retail", headerName: "Retail", maxWidth: 100, valueFormatter: (p) => money(p.value), type: "numericColumn" },
  { field: "savings", headerName: "Saving", maxWidth: 95, valueFormatter: (p) => (p.value == null ? "" : `${p.value}%`), type: "numericColumn", enableCellChangeFlash: true },
  { field: "note", headerName: "Pool Builder note", minWidth: 260, tooltipField: "note" },
];

export function PoolGrid({ rows }: { rows: Row[] }) {
  return <Grid rows={rows} cols={cols} height={Math.min(520, 60 + rows.length * 42)} getRowId={(r) => r.id} />;
}
