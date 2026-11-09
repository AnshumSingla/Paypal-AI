// Numbers and real moments for the landing page, all read from the settled weeks in the database.
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import type { DB } from "./db";
import * as s from "./db/schema";
import { SOCIETY_ID } from "./db/seed";
import { SECRETARY } from "./ai/secretary";
import { cycleMoney } from "./queries";
import { ledgerTotals } from "./engine/ledger";
import { trustScores } from "./engine/trust";

export async function landingFacts(db: DB) {
  const closed = await db.select().from(s.cycle).where(and(eq(s.cycle.societyId, SOCIETY_ID), eq(s.cycle.phase, "CLOSED"))).orderBy(desc(s.cycle.createdAt));
  const money = await Promise.all(closed.map((c) => cycleMoney(db, c.id)));
  const ids = closed.length ? closed.map((c) => c.id) : ["-"];
  const [flats] = await db
    .select({ n: sql<number>`count(distinct ${s.basket.householdId})::int` })
    .from(s.basket)
    .where(and(inArray(s.basket.cycleId, ids), inArray(s.basket.status, ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"])));
  const [refunds] = await db.select({ n: sql<number>`count(*)::int` }).from(s.issue).where(eq(s.issue.decision, "auto_approved"));
  const ledger = await ledgerTotals(db);

  // The Secretary's most recent ask to a supplier that got a lower price, and the reply.
  const asks = await db.select().from(s.activity).where(and(eq(s.activity.actor, SECRETARY), like(s.activity.message, "To %"))).orderBy(desc(s.activity.createdAt)).limit(20);
  let ask: { to: string; reply: string } | null = null;
  for (const a of asks) {
    const supplier = a.message.slice(3, a.message.indexOf(":"));
    const [reply] = await db
      .select()
      .from(s.activity)
      .where(and(eq(s.activity.actor, supplier), like(s.activity.message, `${supplier} lowered %`)))
      .orderBy(desc(s.activity.createdAt))
      .limit(1);
    if (reply) {
      ask = { to: a.message, reply: reply.message };
      break;
    }
  }

  const sellers = await db.select().from(s.seller).where(eq(s.seller.status, "approved"));
  const trust = await trustScores(db, "seller", sellers.map((x) => x.id));
  return {
    weeks: closed.length,
    flats: flats.n,
    saved: money.reduce((t, m) => t + m.savings, 0),
    retail: money.reduce((t, m) => t + m.retailEquivalent, 0),
    autoRefunds: refunds.n,
    balanced: ledger.balanced,
    ask,
    trust: sellers.map((x) => ({ name: x.businessName, score: trust.get(x.id) ?? 75 })).sort((a, b) => b.score - a.score),
  };
}
