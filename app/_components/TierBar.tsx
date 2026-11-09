// Visual of a pool's price tiers and how far the building is along them.
import type { Tier } from "@/lib/db/schema";
import { fmt } from "@/lib/util/money";

export function TierBar({ tiers, committed, pending = 0, retail }: { tiers: Tier[]; committed: number; pending?: number; retail: number }) {
  const max = Math.max(tiers.at(-1)!.minQty * 1.15, committed + pending, 1);
  const pctOf = (q: number) => `${Math.min(100, (q / max) * 100)}%`;
  return (
    <div className="w-full">
      {/* Widths animate when neighbours join, so the drop to a cheaper tier is visible. */}
      <div className="relative h-2.5 rounded-full bg-[#efeff0]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand/25 transition-[width] duration-700 ease-out" style={{ width: pctOf(committed + pending) }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-700 ease-out" style={{ width: pctOf(committed) }} />
        {tiers.map((t) => (
          <div key={t.minQty} className={`absolute -top-1 h-[18px] w-px transition-colors duration-500 ${committed >= t.minQty ? "bg-brand" : "bg-ink/30"}`} style={{ left: pctOf(t.minQty) }} />
        ))}
      </div>
      <div className="num relative mt-1.5 h-9 text-[11px] leading-tight text-muted">
        {/* Labels closer than ~9% of the bar would overlap; the deeper break keeps its label. */}
        {tiers.map((t, i) => (i < tiers.length - 1 && (tiers[i + 1].minQty - t.minQty) / max < 0.09 ? null : (
          <div key={t.minQty} className={`absolute -translate-x-1/2 text-center transition-colors duration-500 ${committed >= t.minQty ? "font-semibold text-brand" : ""}`} style={{ left: pctOf(t.minQty) }}>
            {i === 0 ? `min ${t.minQty}` : `${t.minQty}+`}
            <br />
            {fmt(t.unitCents)}
          </div>
        )))}
      </div>
      <div className="num text-xs text-muted">
        Retail {fmt(retail)}. {committed} held{pending ? `, ${pending} not yet confirmed` : ""}.
      </div>
    </div>
  );
}
