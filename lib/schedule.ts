// The week as a timeline: when lists close, when suppliers bid, when PayPal holds and charges,
// when the delivery comes, how long problems can be reported, and when suppliers are paid.
import type * as s from "./db/schema";

export type ScheduleRow = { id: string; name: string };
export type ScheduleEvent = { id: string; resourceId: string; name: string; startDate: string; endDate: string; state: "done" | "now" | "next" };

const HOUR = 3600 * 1000;
const PHASE_ORDER = ["COLLECT", "BID", "COMMIT", "FULFIL", "RESOLVE", "CLOSED"] as const;

export function weekSchedule(cycle: Pick<typeof s.cycle.$inferSelect, "phase" | "deadlines" | "createdAt">, dropPoint: string) {
  const d = cycle.deadlines;
  const issueEnd = new Date(new Date(d.dropEnd).getTime() + 24 * HOUR).toISOString();
  const now = PHASE_ORDER.indexOf(cycle.phase);
  const state = (phase: (typeof PHASE_ORDER)[number]) => {
    const i = PHASE_ORDER.indexOf(phase);
    return i < now ? "done" : i === now ? "now" : "next";
  };
  const rows: ScheduleRow[] = [
    { id: "lists", name: "Lists" },
    { id: "bids", name: "Supplier bids" },
    { id: "paypal", name: "PayPal" },
    { id: "drop", name: "Delivery" },
    { id: "issues", name: "Problems" },
  ];
  const events: ScheduleEvent[] = [
    { id: "e-lists", resourceId: "lists", name: "Add lists", startDate: cycle.createdAt.toISOString(), endDate: d.collect, state: state("COLLECT") },
    { id: "e-bids", resourceId: "bids", name: "Bids", startDate: d.collect, endDate: d.bid, state: state("BID") },
    { id: "e-holds", resourceId: "paypal", name: "Hold the max", startDate: d.bid, endDate: d.cutoff, state: state("COMMIT") },
    { id: "e-charge", resourceId: "paypal", name: "Charged", startDate: d.cutoff, endDate: d.cutoff, state: state("COMMIT") === "next" ? "next" : "done" },
    { id: "e-drop", resourceId: "drop", name: `Drop at ${dropPoint}`, startDate: d.dropStart, endDate: d.dropStart, state: state("FULFIL") },
    { id: "e-issues", resourceId: "issues", name: "Report problems", startDate: d.dropEnd, endDate: issueEnd, state: state("RESOLVE") },
    { id: "e-payout", resourceId: "paypal", name: "Suppliers paid", startDate: issueEnd, endDate: issueEnd, state: state("CLOSED") === "now" ? "done" : "next" },
  ];
  const day = (iso: string, add: number) => {
    const x = new Date(iso);
    x.setHours(0, 0, 0, 0);
    return new Date(x.getTime() + add * 24 * HOUR).toISOString();
  };
  return { rows, events, startDate: day(cycle.createdAt.toISOString(), 0), endDate: day(issueEnd, 2) };
}
