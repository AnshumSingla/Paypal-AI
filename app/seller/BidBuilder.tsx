"use client";
// Supplier bid form with the Pricing Copilot: AI drafts a minimum order and price breaks, the supplier edits and submits.
import { useState, useTransition } from "react";
import { submitBidAction, suggestTiersAction } from "@/app/actions";
import { Spinner, Toast } from "@/app/_components/ActionButton";
import type { Tier } from "@/lib/db/schema";

const dollars = (c: number) => (c / 100).toFixed(2);
const cents = (d: string) => Math.round(Number(d) * 100);

export function BidBuilder({ poolId, demand, retailCents, title, existing }: { poolId: string; demand: number; retailCents: number; title: string; existing?: { moq: number; maxCapacity: number; tiers: Tier[]; deliveryWindow: string } }) {
  const [moq, setMoq] = useState(existing?.moq ?? Math.max(4, Math.round(demand * 0.6)));
  const [cap, setCap] = useState(existing?.maxCapacity ?? demand * 2);
  const [tiers, setTiers] = useState<{ minQty: number; price: string }[]>(
    existing?.tiers.map((t) => ({ minQty: t.minQty, price: dollars(t.unitCents) })) ?? [
      { minQty: Math.max(4, Math.round(demand * 0.6)), price: dollars(Math.round(retailCents * 0.9)) },
      { minQty: demand, price: dollars(Math.round(retailCents * 0.84)) },
    ],
  );
  const [windowText, setWindow] = useState(existing?.deliveryWindow ?? "Sat 9:00–12:00");
  const [cost, setCost] = useState("");
  const [rationale, setRationale] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const syncMoq = (v: number) => {
    setMoq(v);
    setTiers((t) => t.map((x, i) => (i === 0 ? { ...x, minQty: v } : x)));
  };

  return (
    <div className="space-y-3 rounded-xl bg-canvas p-4 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-28">
          <span className="label">Minimum order</span>
          <input type="number" className="input" value={moq} min={1} onChange={(e) => syncMoq(Number(e.target.value))} />
        </label>
        <label className="w-28">
          <span className="label">Max capacity</span>
          <input type="number" className="input" value={cap} min={1} onChange={(e) => setCap(Number(e.target.value))} />
        </label>
        <label className="w-40">
          <span className="label">Delivery window</span>
          <input className="input" value={windowText} onChange={(e) => setWindow(e.target.value)} />
        </label>
        <label className="w-32">
          <span className="label">Your cost per pack, $</span>
          <input className="input" placeholder="optional" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
        <button
          className="btn btn-ghost bg-white"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await suggestTiersAction(poolId, cost ? cents(cost) : undefined);
              if (!r.ok) return setMsg({ ok: false, text: r.error });
              const d = r.data!.data;
              setMoq(d.moq);
              setCap(d.maxCapacity);
              setTiers(d.tiers.map((t) => ({ minQty: t.minQty, price: dollars(t.unitCents) })));
              setRationale(`${r.data!.source === "ai" ? "Suggested by AI" : "Suggested by pricing rules"}: ${d.rationale}`);
            })
          }
        >
          {pending ? <Spinner /> : null} Suggest prices
        </button>
      </div>
      {rationale && <p className="text-xs text-brand">{rationale}</p>}
      <div>
        <span className="label">Price breaks, per pack delivered to the building</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1">
              <input type="number" className="w-14 text-right" value={t.minQty} disabled={i === 0} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: Number(e.target.value) } : x)))} />
              <span className="text-muted">or more at $</span>
              <input className="w-16" value={t.price} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              {i > 0 && (
                <button className="text-muted hover:text-danger" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Remove price break">
                  ×
                </button>
              )}
            </div>
          ))}
          {tiers.length < 5 && (
            <button className="btn btn-ghost !py-1 bg-white" onClick={() => setTiers([...tiers, { minQty: (tiers.at(-1)?.minQty ?? moq) + 10, price: dollars(cents(tiers.at(-1)?.price ?? "1") - 20) }])}>
              Add price break
            </button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted">Retail is {`$${dollars(retailCents)}`}. The first price must be below retail, and each break cheaper than the one before.</p>
      </div>
      <button
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await submitBidAction({ poolId, moq, maxCapacity: cap, deliveryWindow: windowText, tiers: tiers.map((t, i) => ({ minQty: i === 0 ? moq : t.minQty, unitCents: cents(t.price) })) });
            setMsg(r.ok ? { ok: true, text: r.message ?? "Bid submitted." } : { ok: false, text: r.error });
          })
        }
      >
        {pending && <Spinner />} {existing ? "Update bid" : "Submit bid"} for {title}
      </button>
      {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
    </div>
  );
}
