"use client";
import { useState, useTransition } from "react";
import { setLineAction } from "@/app/actions";
import { Spinner, Toast } from "@/app/_components/ActionButton";

export function QtyStepper({ cycleId, poolId, qty, max = 10, held }: { cycleId: string; poolId: string; qty: number; max?: number; held: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const set = (n: number) => {
    if (held && !window.confirm("Changing your basket voids your current PayPal hold. You'll confirm again with the new total. Continue?")) return;
    start(async () => {
      const r = await setLineAction(cycleId, poolId, n);
      setErr(r.ok ? null : r.error);
    });
  };
  return (
    <span className="inline-flex flex-col items-end">
      <span className="inline-flex items-center overflow-hidden rounded-lg border border-line">
        <button className="px-2.5 py-1 hover:bg-canvas disabled:opacity-40" disabled={pending || qty <= 0} onClick={() => set(qty - 1)} aria-label="Decrease">
          −
        </button>
        <span className="min-w-8 px-1 text-center text-sm font-bold">{pending ? <Spinner /> : qty}</span>
        <button className="px-2.5 py-1 hover:bg-canvas disabled:opacity-40" disabled={pending || qty >= max} onClick={() => set(qty + 1)} aria-label="Increase">
          +
        </button>
      </span>
      {err ? <Toast ok={false} text={err} /> : null}
    </span>
  );
}
