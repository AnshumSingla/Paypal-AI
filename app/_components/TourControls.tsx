"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tourJumpAction, tourNextAction } from "@/app/actions";
import { Spinner, Toast } from "./ActionButton";

/** Runs the tour's current step, then opens the view where the next step happens. */
export function TourControls({ cycleId, action, jumpTo, jumpLabel }: { cycleId: string; action: string | null; jumpTo: "resident" | "captain" | "seller" | "operator" | null; jumpLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (fn: () => ReturnType<typeof tourNextAction>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      if (r.ok && r.data?.href) router.push(r.data.href);
      router.refresh();
    });
  return (
    <div className="flex max-w-sm flex-col items-end gap-1.5">
      <div className="flex gap-2">
        {jumpTo && (
          <button className="btn btn-ghost bg-white" disabled={pending} onClick={() => go(() => tourJumpAction(jumpTo))}>
            {jumpLabel}
          </button>
        )}
        {action && (
          <button className="btn btn-primary" disabled={pending} onClick={() => go(() => tourNextAction(cycleId))}>
            {pending && <Spinner />}
            {action}
          </button>
        )}
      </div>
      {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
    </div>
  );
}
