// The guided demo strip at the top of every role page (demo mode only).
import type * as s from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { TOUR_TOTAL, tourStep } from "@/lib/engine/tour";
import { TourControls } from "./TourControls";

const WHO = { resident: "Ananya's view", captain: "the captain's view", seller: "the supplier's view", operator: "the operator's view" } as const;

export async function TourBar({ cycle }: { cycle: typeof s.cycle.$inferSelect }) {
  const { db, user } = await getSession();
  const step = await tourStep(db, cycle);
  const here = user?.role === step.as;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-brand-soft/60 px-5 py-4">
      <div className="max-w-2xl">
        <div className="num text-sm text-muted">
          Guided demo, step {step.n} of {TOUR_TOTAL}
          {here ? "" : `, shown in ${WHO[step.as]}`}
        </div>
        <div className="mt-0.5 text-lg font-semibold">{step.title}</div>
        <p className="mt-1 text-muted">{step.body}</p>
        {step.edge?.length ? (
          <details className="group mt-2">
            <summary className="cursor-pointer text-sm font-semibold text-brand marker:content-none">
              <span className="inline-block transition-transform group-open:rotate-90">›</span> What could go wrong here?
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {step.edge.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <TourControls cycleId={cycle.id} action={step.action} jumpTo={here ? null : step.as} jumpLabel={`Open ${WHO[step.as]}`} />
    </div>
  );
}
