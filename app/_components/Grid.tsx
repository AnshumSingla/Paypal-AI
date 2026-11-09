"use client";
// AG Grid wrapper with Collective's theme. Used for the demand board, bids, ledger and payouts.
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export const gridTheme = themeQuartz.withParams({
  fontFamily: "var(--pc-font)",
  fontSize: 14.5,
  foregroundColor: "var(--pc-ink)",
  backgroundColor: "var(--pc-surface)",
  borderColor: "var(--pc-border)",
  accentColor: "var(--pc-brand)",
  headerBackgroundColor: "var(--pc-canvas)",
  headerTextColor: "var(--pc-muted)",
  headerFontWeight: 500,
  rowHoverColor: "var(--pc-brand-soft)",
  wrapperBorderRadius: 12,
  spacing: 6,
});

export const money = (v: number | null | undefined) => (v == null ? "" : `${v < 0 ? "-" : ""}$${(Math.abs(v) / 100).toFixed(2)}`);

export function Grid<T>({ rows, cols, height = 360, getRowId }: { rows: T[]; cols: ColDef<T>[]; height?: number; getRowId?: (row: T) => string }) {
  return (
    <div style={{ height }} className="w-full">
      <AgGridReact<T>
        theme={gridTheme}
        rowData={rows}
        columnDefs={cols}
        defaultColDef={{ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 90 }}
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        animateRows
        suppressCellFocus
      />
    </div>
  );
}
