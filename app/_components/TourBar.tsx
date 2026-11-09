// The guided tour, shown on every role page in demo mode as a spotlight over the part of the page
// the current step is about (see TourSpotlight). The step itself is worked out from the database.
import type * as s from "@/lib/db/schema";
import { getSession } from "@/lib/session";
import { TOUR_TOTAL, tourStep } from "@/lib/engine/tour";
import { TourSpotlight } from "./TourSpotlight";

const WHO = { resident: "Ananya's view", captain: "the captain's view", seller: "the supplier's view", operator: "the operator's view" } as const;

/** Which part of the page each step points at (elements carry data-tour="..."). */
const TARGET: Record<string, string> = {
  list: "list",
  "close-collect": "demand",
  bids: "demand",
  "close-bid": "bids",
  hold: "basket",
  neighbours: "pools",
  "money-on-table": "money",
  cutoff: "basket",
  handover: "receipt",
  issue: "receipt",
  payout: "payouts",
  done: "stats",
  decide: "issues",
};

export async function TourBar({ cycle }: { cycle: typeof s.cycle.$inferSelect }) {
  const { db, user } = await getSession();
  const step = await tourStep(db, cycle);
  const here = user?.role === step.as;
  return (
    <TourSpotlight
      cycleId={cycle.id}
      step={{ choices: step.choices ?? [], n: step.n, total: TOUR_TOTAL, title: step.title, body: step.body, edge: step.edge ?? [], action: step.action, target: TARGET[step.id] ?? null, here, jumpTo: step.as, jumpLabel: `Open ${WHO[step.as]}` }}
    />
  );
}
