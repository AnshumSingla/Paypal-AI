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
import { cardCheckout, getOrCreateBasket, setLineQty, withdrawBasket } from "./basket";
import { simulateCompetingBids, simulateNeighbours } from "./demo";
import { decideIssue, reportIssue } from "./refunds";
import { log } from "./ledger";

const RESIDENT_HH = "hh_31";
const SAMPLE_LIST = "2 dozen eggs, any brand\n10lb India Gate basmati\ntoor dal 4 lb\n1 gal whole milk x2\n6 pack beer";
export const TOUR_TOTAL = 12;

type As = keyof typeof PERSONAS;
/** edge: what could go wrong at this step and what Collective does about it, in plain words. */
/** choices: the reviewer picks what happens at this step (each runs the real engine). */
export type TourChoice = { id: string; label: string; hint: string };
export type TourStep = { n: number; as: As; title: string; body: string; action: string | null; id: string; edge?: string[]; choices?: TourChoice[] };

type Cycle = typeof s.cycle.$inferSelect;

export async function tourStep(db: DB, c: Cycle): Promise<TourStep> {
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
  switch (c.phase) {
    case "COLLECT": {
      const mine = await n(db.select({ n: count() }).from(s.need).where(and(eq(s.need.cycleId, c.id), eq(s.need.householdId, RESIDENT_HH))));
      if (!mine) return { n: 1, id: "list", as: "resident", title: "Ananya adds this week's list", body: "She can type it or photograph a handwritten one. The Basket Assistant turns it into products and blocks anything that can't be sold.", action: "Add Ananya's list", edge: ["The list includes beer. Collective can't sell alcohol, tobacco or medicines, so those lines are blocked before any supplier sees them.","Items the catalog doesn't know are looked up with Channel3, or left for Ananya to fix. Nothing on the list is a commitment yet."] };
      return { n: 2, id: "close-collect", as: "captain", title: "The captain closes collection", body: "Every product the building asked for becomes a pool for local suppliers to bid on.", action: "Close collection", edge: ["A product nobody else wants still becomes a pool. If no supplier bids on it, it's dropped and nobody is asked to pay for it."] };
    }
    case "BID": {
      const others = await n(db.select({ n: count() }).from(s.bid).innerJoin(s.pool, eq(s.bid.poolId, s.pool.id)).where(and(eq(s.pool.cycleId, c.id), ne(s.bid.sellerId, "sel_fresh"))));
      if (!others) return { n: 3, id: "bids", as: "captain", title: "Local suppliers bid", body: "Suppliers see totals only, never who ordered what. Each bid is a ladder of prices that drop as the order grows.", action: "Bring in supplier bids", edge: ["Suppliers never see names or flats, only totals. A supplier still awaiting approval can't bid.","Every bid must start below the retail price, so residents always save something."] };
      return { n: 4, id: "close-bid", as: "captain", title: "Trust beats cheap", body: "Code scores each bid on price, the supplier's verified track record and whether the minimum is reachable; the AI explains why. Closing bidding picks the top bid for each pool.", action: "Close bidding", edge: ["The cheapest bid doesn't win automatically: a supplier with upheld complaints scores lower on trust.","The captain can override the pick for any pool before residents confirm."] };
    }
    case "COMMIT": {
      const [bk] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH)));
      if (bk?.status !== "AUTHORIZED") return { n: 5, id: "hold", as: "resident", title: "Ananya approves one PayPal hold", body: "One hold covers the highest price her items could cost. She'll be charged only the price the building unlocks at cutoff.", action: "Place Ananya's PayPal hold", edge: ["The hold is for the highest price on the ladder, so it always covers the final charge.","If Ananya changes her basket, the old hold is voided and a new one placed. She is never held twice."] };
      const held = await n(db.select({ n: count() }).from(s.basket).where(and(eq(s.basket.cycleId, c.id), eq(s.basket.status, "AUTHORIZED"))));
      if (held < 20) return { n: 6, id: "neighbours", as: "resident", title: "Neighbours join, prices drop", body: "Each flat that approves a hold pushes the pool towards a cheaper price break, and the price falls for everyone in it.", action: "12 more flats confirm", choices: [{ id: "decline", label: "12 flats confirm, one card is declined", hint: "That flat isn't in the order. Nobody else is affected." }, { id: "all", label: "12 flats confirm", hint: "Every hold is approved and prices fall for everyone." }, { id: "withdraw", label: "Ananya withdraws instead", hint: "Her PayPal hold is voided at once, and the tour goes back to her hold." }], edge: ["If a neighbour's card is declined, that flat simply isn't in the order: no one else is affected and nothing is charged.","Neighbours can withdraw until cutoff; their hold is voided at once."] };
      const asked = await n(db.select({ n: count() }).from(s.activity).where(and(eq(s.activity.cycleId, c.id), eq(s.activity.actor, SECRETARY), like(s.activity.message, "To %"))));
      if (!asked) return { n: 7, id: "money-on-table", as: "captain", title: "Money on the table", body: "The Secretary tells each supplier how many households and dollars are already authorized in PayPal, and asks for a lower price at that quantity. Prices can only go down.", action: "Let the Secretary negotiate", edge: ["A supplier can lower a price but never below its own floor, and the first price never changes, so every hold still covers the charge.","A supplier can decline. Then nothing changes."] };
      return { n: 8, id: "cutoff", as: "resident", title: "Cutoff: PayPal charges the final price", body: "Each hold is captured at the price the building reached. The rest of every hold goes straight back.", action: "Cut off and charge", edge: ["Pools that missed their minimum are released: those holds are voided and nobody pays for them.","If one capture fails, only that flat's items are released. Cutoff can be re-run without charging anyone twice."] };
    }
    case "FULFIL":
      return { n: 9, id: "handover", as: "resident", title: "Ananya's receipt", body: "Approved, paid and released, with the PayPal ID of each step. Next, the captain checks the delivery.", action: "Confirm the delivery", edge: ["The receipt shows the PayPal ID of every step, and Ananya can check her hold with PayPal from there."] };
    case "RESOLVE": {
      const issues = await n(
        db
          .select({ n: count() })
          .from(s.issue)
          .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
          .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
          .where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH))),
      );
      const [pending] = await db
        .select({ id: s.issue.id })
        .from(s.issue)
        .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
        .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
        .where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH), eq(s.issue.decision, "pending")));
      if (pending)
        return { n: 10, id: "decide", as: "captain", title: "The captain decides", body: "The claim is over the Secretary's $10 limit, so a person decides. Approving refunds it through PayPal and charges it to the supplier.", action: "Approve the refund", edge: ["A rejected claim is recorded against the household's reliability, never as a penalty in money.", "Refunds never exceed what was charged for the item."], choices: [{ id: "approve", label: "Approve the refund", hint: "PayPal refunds Ananya; the supplier's payout and trust score take the hit." }, { id: "reject", label: "Reject the claim", hint: "No refund. The decision is logged with who made it." }] };
      if (!issues) return { n: 10, id: "issue", as: "resident", title: "Something was missing", body: "Ananya reports a missing pack. The Society Secretary checks the claim against the limits and refunds it through PayPal itself.", action: "Report a missing pack", choices: [{ id: "small", label: "One pack was missing", hint: "Under $10, so the Secretary refunds it through PayPal itself." }, { id: "large", label: "A whole item over $10 was missing", hint: "Over the Secretary's limit, so the captain decides." }], edge: ["The Secretary refunds at most $10 per issue, never more than was charged for the item, and at most 3 times per flat in 30 days. Anything bigger goes to the captain.","Damaged, wrong or poor-quality items need a photo. Refunds come out of that supplier's payout and lower its trust score."] };
      return { n: 11, id: "payout", as: "seller", title: "Suppliers get paid", body: "When the window for problems closes, each supplier is paid through PayPal Payouts, minus commission and any refunds.", action: "Close the window and pay suppliers", edge: ["Payouts wait until the 24-hour window for problems closes. If a payout fails, the supplier fixes their details and retries; PayPal never pays the same item twice."] };
    }
    case "CLOSED":
      return { n: 12, id: "done", as: "operator", title: "The week in numbers", body: "The ledger balances to the cent. Open Analytics to see savings, pool outcomes and supplier trust, or ask the AI analyst a question.", action: null, edge: ["Press Start over on the home page to run the week again, or open next week under Manual controls to see trust scores carry over."] };
  }
}

/** Run the current step. Returns a short message for the screen. */
export async function performTourStep(db: DB, c: Cycle, actor: string, choice?: string): Promise<string> {
  const step = await tourStep(db, c);
  switch (step.id) {
    case "list": {
      const r = await parseBasket(db, { text: SAMPLE_LIST, householdId: RESIDENT_HH });
      const usable = r.lines.filter((l) => l.productId && !l.restricted);
      const blocked = r.lines.filter((l) => l.restricted).length;
      if (usable.length) await db.insert(s.need).values(usable.map((l) => ({ id: newId("need"), cycleId: c.id, householdId: RESIDENT_HH, rawText: l.raw, productId: l.productId, qty: l.quantity, brandFlexible: l.brandFlexible, source: "text" as const })));
      await log(db, c.id, "Ananya Kulkarni", "resident", `Added ${usable.length} item(s) to this week's needs.`);
      return `Ananya's list became ${usable.length} products${blocked ? `; ${blocked} restricted item${blocked > 1 ? "s were" : " was"} blocked` : ""}.`;
    }
    case "bids":
      return `${await simulateCompetingBids(db, c.id)} supplier bids came in.`;
    case "hold": {
      const bk = await getOrCreateBasket(db, c.id, RESIDENT_HH);
      // Ananya takes 4 packs of the building's most popular item, so the tour can show both a small
      // claim the Secretary refunds and one over its $10 limit that goes to the captain.
      const [popular] = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, c.id), eq(s.pool.status, "PRICED"))).orderBy(sql`${s.pool.demandEstimate} desc`).limit(1);
      if (popular) {
        const [have] = await db.select().from(s.basketLine).where(and(eq(s.basketLine.basketId, bk.id), eq(s.basketLine.poolId, popular.id)));
        if (!have || have.qty < 4) await setLineQty(db, { cycleId: c.id, householdId: RESIDENT_HH, poolId: popular.id, qty: 4, actor });
      }
      await db.update(s.payment).set({ status: "SUPERSEDED" }).where(and(eq(s.payment.basketId, bk.id), eq(s.payment.status, "CREATED")));
      await cardCheckout(db, bk.id, "Ananya Kulkarni");
      return "Ananya's PayPal hold is in place.";
    }
    case "neighbours": {
      if (choice === "withdraw") {
        const [bk] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH)));
        await withdrawBasket(db, bk.id, "Ananya Kulkarni");
        return "Ananya withdrew. Her PayPal hold was voided and she won't be charged.";
      }
      const r = await simulateNeighbours(db, c.id, 12, actor, { declineLast: choice !== "all" });
      return `${r.joined} more flats approved PayPal holds${r.failed ? `; ${r.failed} card was declined, so that flat isn't in the order and no one else is affected` : ""}.`;
    }
    case "money-on-table":
      return (await runSecretary(db, { cycleId: c.id, role: "system", task: { kind: "funded_asks" } })).reply;
    case "issue": {
      const [line] = await db
        .select({ l: s.basketLine })
        .from(s.basketLine)
        .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
        .where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH), eq(s.basketLine.status, "won")))
        .orderBy(choice === "large" ? sql`${s.basketLine.qty} * ${s.basketLine.finalUnitCents} desc` : s.basketLine.finalUnitCents)
        .limit(1);
      if (!line) return "Ananya has nothing delivered to report on.";
      const whole = choice === "large";
      const r = await reportIssue(db, { basketLineId: line.l.id, householdId: RESIDENT_HH, type: "missing", qty: whole ? line.l.qty : 1, description: whole ? "None of this item was in my delivery." : "One pack wasn't in my bag.", actor: "Ananya Kulkarni" });
      return r.decision === "auto_approved" ? `The Secretary refunded $${(r.refundCents / 100).toFixed(2)} through PayPal.` : "The Secretary passed the claim to the captain.";
    }
    case "decide": {
      const [iss] = await db
        .select({ id: s.issue.id })
        .from(s.issue)
        .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
        .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
        .where(and(eq(s.basket.cycleId, c.id), eq(s.basket.householdId, RESIDENT_HH), eq(s.issue.decision, "pending")));
      const approve = choice !== "reject";
      await decideIssue(db, iss.id, approve, "Rohan Mehta");
      return approve ? "The captain approved it: PayPal refunded Ananya." : "The captain rejected the claim. No refund.";
    }
    case "done":
      return "That's the whole week.";
    default:
      return advance(db, c.id, actor);
  }
}
