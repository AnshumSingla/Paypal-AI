// Guided demo: one "next step" at a time through a whole week, worked out from what's in the
// database (no stored tour state). Each step runs the same engine code as the normal buttons.
import { and, count, eq, like, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";
import { PERSONAS } from "../db/seed";
import { parseBasket } from "../ai/agents/basket";
import { runSecretary, SECRETARY } from "../ai/secretary";
import { advance } from "./cycle";
import { cardCheckout, getOrCreateBasket, setLineQty } from "./basket";
import { simulateCompetingBids, simulateNeighbours } from "./demo";
import { reportIssue } from "./refunds";
import { log } from "./ledger";

const RESIDENT_HH = "hh_31";
const SAMPLE_LIST = "2 dozen eggs, any brand\n10lb India Gate basmati\ntoor dal 4 lb\n1 gal whole milk x2";
export const TOUR_TOTAL = 12;

type As = keyof typeof PERSONAS;
export type TourStep = { n: number; as: As; title: string; body: string; action: string | null; id: string };

type Cycle = typeof s.cycle.$inferSelect;

export async function tourStep(db: DB, c: Cycle): Promise<TourStep> {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  switch (c.phase) {
    case "COLLECT": {
      const mine = await n(db.select({ n: count() }).from(s.need).where(and(eq(s.need.cycleId, c.id), eq(s.need.householdId, RESIDENT_HH))));
      if (!mine) return { n: 1, id: "list", as: "resident", title: "Ananya adds this week's list", body: "She can type it or photograph a handwritten one. The Basket Assistant turns it into products and blocks anything that can't be sold.", action: "Add Ananya's list" };
      return { n: 2, id: "close-collect", as: "captain", title: "The captain closes collection", body: "Every product the building asked for becomes a pool for local suppliers to bid on.", action: "Close collection" };
    }
    case "BID": {
      const others = await n(db.select({ n: count() }).from(s.bid).innerJoin(s.pool, eq(s.bid.poolId, s.pool.id)).where(and(eq(s.pool.cycleId, c.id), ne(s.bid.sellerId, "sel_fresh"))));
      if (!others) return { n: 3, id: "bids", as: "captain", title: "Local suppliers bid", body: "Suppliers see totals only, never who ordered what. Each bid is a ladder of prices that drop as the order grows.", action: "Bring in supplier bids" };
      return { n: 4, id: "close-bid", as: "captain", title: "Trust beats cheap", body: "Code scores each bid on price, the supplier's verified track record and whether the minimum is reachable; the AI explains why. Closing bidding picks the top bid for each pool.", action: "Close bidding" };
    }
    case "COMMIT": {
      const [bk] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH)));
      if (bk?.status !== "AUTHORIZED") return { n: 5, id: "hold", as: "resident", title: "Ananya approves one PayPal hold", body: "One hold covers the highest price her items could cost. She'll be charged only the price the building unlocks at cutoff.", action: "Place Ananya's PayPal hold" };
      const held = await n(db.select({ n: count() }).from(s.basket).where(and(eq(s.basket.cycleId, c.id), eq(s.basket.status, "AUTHORIZED"))));
      if (held < 20) return { n: 6, id: "neighbours", as: "resident", title: "Neighbours join, prices drop", body: "Each flat that approves a hold pushes the pool towards a cheaper price break, and the price falls for everyone in it.", action: "12 more flats confirm" };
      const asked = await n(db.select({ n: count() }).from(s.activity).where(and(eq(s.activity.cycleId, c.id), eq(s.activity.actor, SECRETARY), like(s.activity.message, "To %"))));
      if (!asked) return { n: 7, id: "money-on-table", as: "captain", title: "Money on the table", body: "The Secretary tells each supplier how many households and dollars are already authorized in PayPal, and asks for a lower price at that quantity. Prices can only go down.", action: "Let the Secretary negotiate" };
      return { n: 8, id: "cutoff", as: "resident", title: "Cutoff: PayPal charges the final price", body: "Each hold is captured at the price the building reached. The rest of every hold goes straight back.", action: "Cut off and charge" };
    }
    case "FULFIL":
      return { n: 9, id: "handover", as: "resident", title: "Ananya's receipt", body: "Approved, paid and released, with the PayPal ID of each step. Next, the captain checks the delivery.", action: "Confirm the delivery" };
    case "RESOLVE": {
      const issues = await n(
        db
          .select({ n: count() })
          .from(s.issue)
          .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
          .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
          .where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH))),
      );
      if (!issues) return { n: 10, id: "issue", as: "resident", title: "Something was missing", body: "Ananya reports a missing pack. The Society Secretary checks the claim against the limits and refunds it through PayPal itself.", action: "Report a missing pack" };
      return { n: 11, id: "payout", as: "seller", title: "Suppliers get paid", body: "When the window for problems closes, each supplier is paid through PayPal Payouts, minus commission and any refunds.", action: "Close the window and pay suppliers" };
    }
    case "CLOSED":
      return { n: 12, id: "done", as: "operator", title: "The week in numbers", body: "The ledger balances to the cent. Open Analytics to see savings, pool outcomes and supplier trust, or ask the AI analyst a question.", action: null };
  }
}

/** Run the current step. Returns a short message for the screen. */
export async function performTourStep(db: DB, c: Cycle, actor: string): Promise<string> {
  const step = await tourStep(db, c);
  switch (step.id) {
    case "list": {
      const r = await parseBasket(db, { text: SAMPLE_LIST, householdId: RESIDENT_HH });
      const usable = r.lines.filter((l) => l.productId && !l.restricted);
      if (usable.length) await db.insert(s.need).values(usable.map((l) => ({ id: newId("need"), cycleId: c.id, householdId: RESIDENT_HH, rawText: l.raw, productId: l.productId, qty: l.quantity, brandFlexible: l.brandFlexible, source: "text" as const })));
      await log(db, c.id, "Ananya Kulkarni", "resident", `Added ${usable.length} item(s) to this week's needs.`);
      return `Ananya's list became ${usable.length} products.`;
    }
    case "bids":
      return `${await simulateCompetingBids(db, c.id)} supplier bids came in.`;
    case "hold": {
      const bk = await getOrCreateBasket(db, c.id, RESIDENT_HH);
      const lines = await db.select({ n: count() }).from(s.basketLine).where(eq(s.basketLine.basketId, bk.id));
      if (!lines[0].n) {
        const [eggs] = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, c.id), eq(s.pool.status, "PRICED"))).orderBy(sql`${s.pool.demandEstimate} desc`).limit(1);
        if (eggs) await setLineQty(db, { cycleId: c.id, householdId: RESIDENT_HH, poolId: eggs.id, qty: 1, actor });
      }
      await db.update(s.payment).set({ status: "SUPERSEDED" }).where(and(eq(s.payment.basketId, bk.id), eq(s.payment.status, "CREATED")));
      await cardCheckout(db, bk.id, "Ananya Kulkarni");
      return "Ananya's PayPal hold is in place.";
    }
    case "neighbours": {
      const r = await simulateNeighbours(db, c.id, 12);
      return `${r.joined} more flats approved PayPal holds${r.failed ? ` (${r.failed} failed)` : ""}.`;
    }
    case "money-on-table":
      return (await runSecretary(db, { cycleId: c.id, role: "system", task: { kind: "funded_asks" } })).reply;
    case "issue": {
      const [line] = await db
        .select({ l: s.basketLine })
        .from(s.basketLine)
        .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
        .where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH), eq(s.basketLine.status, "won")))
        .orderBy(s.basketLine.finalUnitCents)
        .limit(1);
      if (!line) return "Ananya has nothing delivered to report on.";
      const r = await reportIssue(db, { basketLineId: line.l.id, householdId: RESIDENT_HH, type: "missing", qty: 1, description: "One pack wasn't in my bag.", actor: "Ananya Kulkarni" });
      return r.decision === "auto_approved" ? `The Secretary refunded $${(r.refundCents / 100).toFixed(2)} through PayPal.` : "The Secretary passed the claim to the captain.";
    }
    case "done":
      return "That's the whole week.";
    default:
      return advance(db, c.id, actor);
  }
}
