// Phase stepper + demo clock shown at the top of every role page.
import { getSession } from "@/lib/session";
import type * as s from "@/lib/db/schema";
import { PHASE_LABEL, PHASES } from "@/lib/engine/cycle";
import { demoMode } from "@/lib/engine/demo";
import { advancePhase, nextCycleAction, resetDemoAction, simulateBidsAction, simulateNeighboursAction } from "@/app/actions";
import { ActionButton } from "./ActionButton";
import { TourBar } from "./TourBar";

const NEXT_LABEL: Record<string, string> = {
  COLLECT: "Close collection and open bidding",
  BID: "Close bidding",
  COMMIT: "Cut off and charge with PayPal",
  FULFIL: "Confirm handover",
  RESOLVE: "Close issue window and pay suppliers",
};

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export async function CycleBar({ cycle, societyName }: { cycle: typeof s.cycle.$inferSelect; societyName: string }) {
  const idx = PHASES.indexOf(cycle.phase);
  const { user } = await getSession();
  return (
    <>
    <header className="mb-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {greeting()}, {user?.role === "operator" ? "Ops team" : (user?.name ?? "").split(" ")[0]}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
        <span className="chip border border-line-strong bg-surface text-ink">{cycle.weekLabel}</span>
        <span className="font-medium text-brand">{PHASE_LABEL[cycle.phase]}</span>
        <span>{societyName}</span>
      </div>
    </header>
    <section className="card mb-6 overflow-hidden">
      {demoMode() && <TourBar cycle={cycle} />}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className="text-sm font-semibold text-muted">This week, step {idx + 1} of {PHASES.length}</div>
        {demoMode() && (
          <details className="group relative">
            <summary className="btn btn-ghost cursor-pointer list-none text-sm marker:content-none">Manual controls</summary>
            <div className="absolute right-0 z-10 mt-2 flex w-72 flex-col gap-2 rounded-2xl border border-line bg-surface p-3 shadow-lg">
            <p className="text-sm text-muted">Skip the tour and move the week yourself.</p>
            {cycle.phase !== "CLOSED" ? (
              <ActionButton action={advancePhase.bind(null, cycle.id)} className="btn btn-ghost !py-1.5 bg-surface">
                {NEXT_LABEL[cycle.phase]}
              </ActionButton>
            ) : (
              <ActionButton action={nextCycleAction} className="btn btn-ghost !py-1.5 bg-surface">
                Open next week
              </ActionButton>
            )}
            {cycle.phase === "BID" && (
              <ActionButton action={simulateBidsAction.bind(null, cycle.id)} className="btn btn-ghost !py-1.5 bg-surface">
                Add competing suppliers
              </ActionButton>
            )}
            {cycle.phase === "COMMIT" && (
              <ActionButton action={simulateNeighboursAction.bind(null, cycle.id, 12)} className="btn btn-ghost !py-1.5 bg-surface">
                12 more flats confirm
              </ActionButton>
            )}
            <ActionButton action={resetDemoAction} className="btn btn-ghost !py-1.5 bg-surface" confirm="Reset all demo data back to the start of Week 46?">
              Reset
            </ActionButton>
            </div>
          </details>
        )}
      </div>
      <ol className="mt-4 grid grid-cols-3 border-t border-line text-sm sm:grid-cols-6">
        {PHASES.map((p, i) => (
          <li key={p} className={`px-3 py-2.5 font-semibold ${i < idx ? "bg-brand-soft text-brand-dark" : i === idx ? "bg-brand text-on-brand" : "text-muted"}`}>
            <span className="opacity-70">{i + 1}.</span> {PHASE_LABEL[p]}
          </li>
        ))}
      </ol>
    </section>
    </>
  );
}
