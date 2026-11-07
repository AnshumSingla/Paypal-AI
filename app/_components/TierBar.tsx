// Visual of a pool's price tiers and how far the building is along them.
import type { Tier } from "@/lib/db/schema";
import { fmt } from "@/lib/util/money";

export function TierBar({ tiers, committed, pending = 0, retail }: { tiers: Tier[]; committed: number; pending?: number; retail: number }) {
  const max = Math.max(tiers.at(-1)!.minQty * 1.15, committed + pending, 1);
  const pctOf = (q: number) => `${Math.min(100, (q / max) * 100)}%`;
  return (
    <div className="w-full">
      <div className="relative h-3 rounded-full bg-canvas">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent/40" style={{ width: pctOf(committed + pending) }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: pctOf(committed) }} />
        {tiers.map((t) => (
          <div key={t.minQty} className="absolute -top-1 h-5 w-0.5 bg-ink/60" style={{ left: pctOf(t.minQty) }} />
        ))}
      </div>
      <div className="relative mt-1 h-8 text-[10px] leading-tight text-muted">
        {tiers.map((t, i) => (
          <div key={t.minQty} className={`absolute -translate-x-1/2 text-center ${committed >= t.minQty ? "font-bold text-brand-dark" : ""}`} style={{ left: pctOf(t.minQty) }}>
            {i === 0 ? "MOQ " : ""}
            {t.minQty}+
            <br />
            {fmt(t.unitCents)}
          </div>
        ))}
      </div>
      <div className="text-[11px] text-muted">Retail {fmt(retail)} · {committed} held{pending ? ` · ${pending} not yet confirmed` : ""}</div>
    </div>
  );
}
