"use client";
import type { ColDef } from "ag-grid-community";
import { Grid, money } from "@/app/_components/Grid";

type Row = { id: string; product: string; pack: string; status: string; demand: number; bids: number; seller: string; moq: number | null; committed: number; unit: number | null; retail: number; savings: number | null; note: string };

const STATUS_STYLE: Record<string, string> = {
  OPEN_FOR_BIDS: "background:#e8effd;color:#2563eb",
  PRICED: "background:#fdf1df;color:#8a5a12",
  SUCCEEDED: "background:#e3f3ec;color:#0a5944",
  DELIVERED: "background:#e3f3ec;color:#0a5944",
  FAILED: "background:#fbe9e9;color:#c23b3b",
  NO_BID: "background:#fbe9e9;color:#c23b3b",
};

const cols: ColDef<Row>[] = [
  { field: "product", headerName: "Pool", minWidth: 200, pinned: "left" },
  { field: "pack", headerName: "Pack", maxWidth: 110 },
  {
    field: "status",
    maxWidth: 140,
    cellRenderer: (p: { value: string }) => <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700, ...Object.fromEntries((STATUS_STYLE[p.value] ?? "").split(";").filter(Boolean).map((kv) => kv.split(":"))) }}>{p.value.replaceAll("_", " ")}</span>,
  },
  { field: "demand", headerName: "Wanted", maxWidth: 100, type: "numericColumn" },
  { field: "bids", maxWidth: 80, type: "numericColumn" },
  { field: "seller", headerName: "Winning seller", minWidth: 150 },
  { field: "moq", headerName: "MOQ", maxWidth: 80, type: "numericColumn" },
  { field: "committed", headerName: "Held", maxWidth: 90, type: "numericColumn" },
  { field: "unit", headerName: "Price now", maxWidth: 110, valueFormatter: (p) => money(p.value), type: "numericColumn" },
  { field: "retail", headerName: "Retail", maxWidth: 100, valueFormatter: (p) => money(p.value), type: "numericColumn" },
  { field: "savings", headerName: "Saving", maxWidth: 95, valueFormatter: (p) => (p.value == null ? "—" : `${p.value}%`), type: "numericColumn" },
  { field: "note", headerName: "AI note", minWidth: 260, tooltipField: "note" },
];

export function PoolGrid({ rows }: { rows: Row[] }) {
  return <Grid rows={rows} cols={cols} height={Math.min(520, 60 + rows.length * 42)} getRowId={(r) => r.id} />;
}
