// Phase stepper + demo clock shown at the top of every role page.
import type * as s from "@/lib/db/schema";
import { PHASE_LABEL, PHASES } from "@/lib/engine/cycle";
import { demoMode } from "@/lib/engine/demo";
import { advancePhase, nextCycleAction, resetDemoAction, simulateBidsAction, simulateNeighboursAction } from "@/app/actions";
import { ActionButton } from "./ActionButton";

const NEXT_LABEL: Record<string, string> = {
  COLLECT: "Close collection and open bidding",
  BID: "Close bidding",
  COMMIT: "Cut off and charge with PayPal",
  FULFIL: "Confirm handover",
  RESOLVE: "Close issue window and pay suppliers",
};

export function CycleBar({ cycle, societyName }: { cycle: typeof s.cycle.$inferSelect; societyName: string }) {
  const idx = PHASES.indexOf(cycle.phase);
  return (
    <section className="card mb-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div>
          <div className="label">{societyName}</div>
          <h1 className="text-xl font-semibold">
            {cycle.weekLabel} · <span className="text-brand">{PHASE_LABEL[cycle.phase]}</span>
          </h1>
        </div>
        {demoMode() && (
          <div className="flex flex-wrap items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2">
            <span className="label self-center">Demo controls</span>
            {cycle.phase !== "CLOSED" ? (
              <ActionButton action={advancePhase.bind(null, cycle.id)} className="btn btn-primary !py-1.5">
                {NEXT_LABEL[cycle.phase]}
              </ActionButton>
            ) : (
              <ActionButton action={nextCycleAction} className="btn btn-primary !py-1.5">
                Open next week
              </ActionButton>
            )}
            {cycle.phase === "BID" && (
              <ActionButton action={simulateBidsAction.bind(null, cycle.id)} className="btn btn-ghost !py-1.5 bg-white">
                Add competing suppliers
              </ActionButton>
            )}
            {cycle.phase === "COMMIT" && (
              <ActionButton action={simulateNeighboursAction.bind(null, cycle.id, 12)} className="btn btn-ghost !py-1.5 bg-white">
                12 more flats confirm
              </ActionButton>
            )}
            <ActionButton action={resetDemoAction} className="btn btn-ghost !py-1.5 bg-white" confirm="Reset all demo data back to the start of Week 46?">
              Reset
            </ActionButton>
          </div>
        )}
      </div>
      <ol className="mt-4 grid grid-cols-3 border-t border-line text-xs sm:grid-cols-6">
        {PHASES.map((p, i) => (
          <li key={p} className={`px-3 py-2.5 font-semibold ${i < idx ? "bg-brand-soft text-brand-dark" : i === idx ? "bg-brand text-white" : "text-muted"}`}>
            <span className="opacity-70">{i + 1}.</span> {PHASE_LABEL[p]}
          </li>
        ))}
      </ol>
    </section>
  );
}
