"use client";
// Supplier bid form with the Pricing Copilot: AI drafts a minimum order and price breaks, the supplier edits and submits.
import { useState, useTransition } from "react";
import { Plus, Sparkles, X } from "lucide-react";
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
    <div className="space-y-4 rounded-xl bg-surface-2 p-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="label">Minimum order</span>
          <input type="number" className="input num mt-1" value={moq} min={1} onChange={(e) => syncMoq(Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="label">Max capacity</span>
          <input type="number" className="input num mt-1" value={cap} min={1} onChange={(e) => setCap(Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="label">Delivery window</span>
          <input className="input mt-1" value={windowText} onChange={(e) => setWindow(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Your cost per pack, $</span>
          <input className="input num mt-1" placeholder="optional" value={cost} onChange={(e) => setCost(e.target.value)} />
        </label>
      </div>

      <fieldset>
        <legend className="label">Price breaks, per pack delivered to the building</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1">
              <input type="number" className="num w-14 text-right" aria-label={`Price break ${i + 1}, minimum packs`} value={t.minQty} disabled={i === 0} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: Number(e.target.value) } : x)))} />
              <span className="text-muted">or more at $</span>
              <input className="num w-16" aria-label={`Price break ${i + 1}, price per pack in dollars`} value={t.price} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              {i > 0 && (
                <button type="button" className="rounded p-0.5 text-muted hover:text-danger" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Remove price break">
                  <X size={16} aria-hidden />
                </button>
              )}
            </div>
          ))}
          {tiers.length < 5 && (
            <button type="button" className="btn btn-ghost !py-1" onClick={() => setTiers([...tiers, { minQty: (tiers.at(-1)?.minQty ?? moq) + 10, price: dollars(cents(tiers.at(-1)?.price ?? "1") - 20) }])}>
              <Plus size={16} aria-hidden /> Add price break
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">Retail is {`$${dollars(retailCents)}`}. Start below retail; each break cheaper than the one before.</p>
      </fieldset>

      {rationale && (
        <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-info">
          <Sparkles size={16} aria-hidden className="mt-1 shrink-0" />
          {rationale}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          type="button"
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
        <button
          type="button"
          className="btn btn-ghost"
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
          {pending ? <Spinner /> : <Sparkles size={16} aria-hidden className="text-info" />} Suggest prices
        </button>
        {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
      </div>
    </div>
  );
}
