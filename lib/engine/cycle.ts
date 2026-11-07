// Cycle state machine (Architecture §6.1): COLLECT → BID → COMMIT → FULFIL → RESOLVE → CLOSED.
// Each transition is guarded (`where phase = current`) so a double click or a cron overlap is a no-op.
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";
import { fmt } from "../util/money";
import { runAgent, structured } from "../ai/claude";
import { analyzeBids } from "../ai/agents/sellerSide";
import { COMMISSION_BPS, ceilingUnit, PolicyError, validateTiers } from "./pricing";
import { log } from "./ledger";
import { settleCycle } from "./settlement";
import { processPayouts } from "./payouts";

export type Phase = (typeof s.cycle.$inferSelect)["phase"];
export const PHASES: Phase[] = ["COLLECT", "BID", "COMMIT", "FULFIL", "RESOLVE", "CLOSED"];
export const PHASE_LABEL: Record<Phase, string> = {
  COLLECT: "Collecting needs",
  BID: "Sellers bidding",
  COMMIT: "Confirm & pay (hold)",
  FULFIL: "Delivery",
  RESOLVE: "Issue window",
  CLOSED: "Closed & paid out",
};

export async function currentCycle(db: DB, societyId: string) {
  const rows = await db.select().from(s.cycle).where(eq(s.cycle.societyId, societyId)).orderBy(sql`${s.cycle.createdAt} desc`).limit(1);
  return rows[0] ?? null;
}

async function setPhase(db: DB, cycleId: string, from: Phase, to: Phase, extra: Partial<typeof s.cycle.$inferInsert> = {}) {
  const r = await db.update(s.cycle).set({ phase: to, ...extra }).where(and(eq(s.cycle.id, cycleId), eq(s.cycle.phase, from))).returning({ id: s.cycle.id });
  if (!r.length) throw new PolicyError(`This cycle is no longer in ${from}.`);
}

/** Advance one phase, running that transition's work. Returns a human summary. */
export async function advance(db: DB, cycleId: string, actor: string): Promise<string> {
  const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, cycleId));
  if (!c) throw new PolicyError("Cycle not found.");
  switch (c.phase) {
    case "COLLECT": {
      const msg = await buildPools(db, c.id);
      await setPhase(db, c.id, "COLLECT", "BID");
      await log(db, c.id, actor, "phase", `Collection closed. ${msg}`);
      return msg;
    }
    case "BID": {
      const msg = await closeBidding(db, c.id, actor);
      await setPhase(db, c.id, "BID", "COMMIT", { commitOpenedAt: new Date() });
      await prefillBaskets(db, c.id);
      await log(db, c.id, actor, "phase", `Bidding closed. ${msg} Residents can now confirm baskets with a PayPal hold.`);
      return msg;
    }
    case "COMMIT": {
      await setPhase(db, c.id, "COMMIT", "FULFIL", { settledAt: new Date() });
      const msg = await settleCycle(db, c.id, actor);
      return msg;
    }
    case "FULFIL": {
      await setPhase(db, c.id, "FULFIL", "RESOLVE", { handoverAt: new Date() });
      await db.update(s.pool).set({ status: "DELIVERED" }).where(and(eq(s.pool.cycleId, c.id), eq(s.pool.status, "SUCCEEDED")));
      await log(db, c.id, actor, "phase", "Captain confirmed the drop was handed over. The 24h issue window is open.");
      return "Handover confirmed; issue window open.";
    }
    case "RESOLVE": {
      const pending = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.issue)
        .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
        .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
        .where(and(eq(s.basket.cycleId, c.id), eq(s.issue.decision, "pending")));
      if (pending[0].n > 0) throw new PolicyError(`Decide the ${pending[0].n} open issue(s) before paying sellers out (Policies §11.1).`);
      await setPhase(db, c.id, "RESOLVE", "CLOSED", { closedAt: new Date() });
      const msg = await processPayouts(db, c.id, actor);
      return msg;
    }
    case "CLOSED":
      throw new PolicyError("This cycle is closed. Start next week's cycle instead.");
  }
}

// ------------------------------------------------------------------ COLLECT → BID: Pool Builder
const Brief = z.object({
  pools: z.array(z.object({ productId: z.string(), note: z.string().describe("One sentence for sellers: who wants it, brand flexibility, anything to know") })),
  mergeSuggestions: z.array(z.string()).describe("Suggestions to merge brand variants, only using brand-flexible demand (Policies §6.2)"),
});

export async function buildPools(db: DB, cycleId: string): Promise<string> {
  const rows = await db
    .select({ productId: s.need.productId, qty: sql<number>`sum(${s.need.qty})::int`, households: sql<number>`count(distinct ${s.need.householdId})::int`, flexible: sql<number>`sum(case when ${s.need.brandFlexible} then ${s.need.qty} else 0 end)::int`, title: s.product.title, brand: s.product.brand, packSize: s.product.packSize })
    .from(s.need)
    .innerJoin(s.product, eq(s.need.productId, s.product.id))
    .where(and(eq(s.need.cycleId, cycleId), eq(s.need.status, "active")))
    .groupBy(s.need.productId, s.product.title, s.product.brand, s.product.packSize);

  const brief = await runAgent(
    db,
    "pool_builder",
    `cycle:${cycleId}`,
    () =>
      structured({
        system: `You are PoolCart's Pool Builder. Each product with demand becomes a pool that local sellers bid on. Write a one-sentence note per pool for sellers (no resident identities) and list merge suggestions only where brand-flexible demand could move to a related pool of the same product type and pack size.`,
        content: rows.map((r) => `${r.productId}: ${r.title}${r.brand ? ` (${r.brand})` : ""} ${r.packSize}: ${r.qty} packs from ${r.households} households, ${r.flexible} packs brand-flexible`).join("\n"),
        schema: Brief,
        effort: "low",
      }),
    () => ({ pools: rows.map((r) => ({ productId: r.productId!, note: `${r.households} households want ${r.qty} packs; ${r.flexible} are brand-flexible.` })), mergeSuggestions: [] }),
  );
  const notes = new Map(brief.data.pools.map((p) => [p.productId, p.note]));
  if (rows.length) {
    await db
      .insert(s.pool)
      .values(rows.map((r) => ({ id: newId("pool"), cycleId, productId: r.productId!, status: "OPEN_FOR_BIDS" as const, demandEstimate: r.qty, aiNotes: notes.get(r.productId!) ?? null })))
      .onConflictDoNothing();
  }
  const merge = brief.data.mergeSuggestions.length ? ` Merge ideas: ${brief.data.mergeSuggestions.join(" ")}` : "";
  return `${rows.length} pools opened for bids (${brief.source === "ai" ? "Pool Builder AI" : "rules"}).${merge}`;
}

// ------------------------------------------------------------------ Bids
export async function submitBid(db: DB, a: { poolId: string; sellerId: string; moq: number; maxCapacity: number; tiers: s.Tier[]; deliveryWindow: string; note?: string }) {
  validateTiers(a.moq, a.maxCapacity, a.tiers);
  const [p] = await db.select().from(s.pool).where(eq(s.pool.id, a.poolId));
  if (!p || p.status !== "OPEN_FOR_BIDS") throw new PolicyError("This pool isn't open for bids.");
  const [sel] = await db.select().from(s.seller).where(eq(s.seller.id, a.sellerId));
  if (!sel || sel.status !== "approved") throw new PolicyError("Only approved sellers can bid (Policies §10.1).");
  if (sel.balanceCents < 0) throw new PolicyError("Clear your negative balance before bidding (Policies §8.5).");
  const [prod] = await db.select().from(s.product).where(eq(s.product.id, p.productId));
  if (a.tiers[0].unitCents >= prod.retailRefCents) throw new PolicyError(`Tier 1 must be below the retail reference (${fmt(prod.retailRefCents)}) so residents save.`);
  // One live bid per seller per pool: replace an earlier one.
  await db.update(s.bid).set({ status: "withdrawn" }).where(and(eq(s.bid.poolId, a.poolId), eq(s.bid.sellerId, a.sellerId), eq(s.bid.status, "submitted")));
  const id = newId("bid");
  await db.insert(s.bid).values({ id, poolId: a.poolId, sellerId: a.sellerId, moq: a.moq, maxCapacity: a.maxCapacity, tiers: a.tiers, deliveryWindow: a.deliveryWindow, note: a.note || null });
  await log(db, p.cycleId, sel.businessName, "seller", `${sel.businessName} bid on ${prod.title}: ${a.tiers.map((t) => `${t.minQty}+ @ ${fmt(t.unitCents)}`).join(", ")}.`);
  await rankPool(db, a.poolId);
  return id;
}

/** Re-run the Bid Analyst for a pool and store scores/rationales on the bids. */
export async function rankPool(db: DB, poolId: string) {
  const [p] = await db.select().from(s.pool).where(eq(s.pool.id, poolId));
  const [prod] = await db.select().from(s.product).where(eq(s.product.id, p.productId));
  const bids = await db.select({ b: s.bid, sel: s.seller }).from(s.bid).innerJoin(s.seller, eq(s.bid.sellerId, s.seller.id)).where(and(eq(s.bid.poolId, poolId), eq(s.bid.status, "submitted")));
  if (!bids.length) return null;
  const analysis = await analyzeBids(db, {
    poolId,
    productTitle: `${prod.title} (${prod.packSize})`,
    demand: p.demandEstimate,
    retailRefCents: prod.retailRefCents,
    bids: bids.map(({ b, sel }) => ({ id: b.id, sellerName: sel.businessName, rating: sel.rating, fillRatePct: sel.fillRatePct, moq: b.moq, maxCapacity: b.maxCapacity, tiers: b.tiers, deliveryWindow: b.deliveryWindow, note: b.note })),
  });
  for (const r of analysis.ranked) await db.update(s.bid).set({ aiScore: r.score, aiRationale: r.rationale, aiFlags: r.flags }).where(eq(s.bid.id, r.bidId));
  await db.update(s.pool).set({ aiRecommendation: analysis.recommendation }).where(eq(s.pool.id, poolId));
  return analysis;
}

export async function selectWinner(db: DB, poolId: string, bidId: string, actor: string) {
  const [p] = await db.select().from(s.pool).where(eq(s.pool.id, poolId));
  if (!p || p.status !== "OPEN_FOR_BIDS") throw new PolicyError("A winner can only be picked while the pool is open for bids.");
  const [b] = await db.select({ b: s.bid, sel: s.seller }).from(s.bid).innerJoin(s.seller, eq(s.bid.sellerId, s.seller.id)).where(and(eq(s.bid.id, bidId), eq(s.bid.poolId, poolId)));
  if (!b || b.b.status !== "submitted") throw new PolicyError("That bid is no longer available.");
  await db.update(s.bid).set({ status: "won", commissionBps: COMMISSION_BPS[b.sel.plan] }).where(eq(s.bid.id, bidId));
  await db.update(s.bid).set({ status: "lost" }).where(and(eq(s.bid.poolId, poolId), eq(s.bid.status, "submitted")));
  await db.update(s.pool).set({ status: "PRICED", winningBidId: bidId }).where(eq(s.pool.id, poolId));
  const [prod] = await db.select().from(s.product).where(eq(s.product.id, p.productId));
  await log(db, p.cycleId, actor, "seller", `${b.sel.businessName} won ${prod.title} (MOQ ${b.b.moq}, from ${fmt(b.b.tiers[0].unitCents)} down to ${fmt(b.b.tiers.at(-1)!.unitCents)}).`);
}

async function closeBidding(db: DB, cycleId: string, actor: string) {
  const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, cycleId));
  const [soc] = await db.select().from(s.society).where(eq(s.society.id, c.societyId));
  const open = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, cycleId), eq(s.pool.status, "OPEN_FOR_BIDS")));
  let auto = 0;
  let none = 0;
  for (const p of open) {
    const bids = await db.select().from(s.bid).where(and(eq(s.bid.poolId, p.id), eq(s.bid.status, "submitted")));
    const eligible = bids.filter((b) => !(b.aiFlags ?? []).some((f) => f.includes("above retail") || f.includes("bait")));
    if (soc.autoSelectBids && eligible.length) {
      const best = [...eligible].sort((x, y) => (y.aiScore ?? 0) - (x.aiScore ?? 0))[0];
      await selectWinner(db, p.id, best.id, `${actor} (auto-select)`);
      auto++;
    } else {
      await db.update(s.pool).set({ status: "NO_BID" }).where(eq(s.pool.id, p.id));
      none++;
    }
  }
  const priced = await db.select({ n: sql<number>`count(*)::int` }).from(s.pool).where(and(eq(s.pool.cycleId, cycleId), eq(s.pool.status, "PRICED")));
  return `${priced[0].n} pools priced (${auto} auto-selected), ${none} without a valid bid.`;
}

/** At COMMIT, turn each household's needs into a draft basket at ceiling prices (they still confirm). */
async function prefillBaskets(db: DB, cycleId: string) {
  const priced = await db.select({ p: s.pool, b: s.bid }).from(s.pool).innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id)).where(and(eq(s.pool.cycleId, cycleId), eq(s.pool.status, "PRICED")));
  const byProduct = new Map(priced.map((r) => [r.p.productId, r]));
  const needs = await db.select().from(s.need).where(and(eq(s.need.cycleId, cycleId), eq(s.need.status, "active")));
  const byHousehold = new Map<string, typeof needs>();
  for (const n of needs) if (n.productId && byProduct.has(n.productId)) byHousehold.set(n.householdId, [...(byHousehold.get(n.householdId) ?? []), n]);
  for (const [householdId, list] of byHousehold) {
    const basketId = newId("bsk");
    await db.insert(s.basket).values({ id: basketId, cycleId, householdId, simulated: list.every((n) => n.source === "simulated") }).onConflictDoNothing();
    const [bk] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, cycleId), eq(s.basket.householdId, householdId)));
    const merged = new Map<string, number>();
    for (const n of list) merged.set(byProduct.get(n.productId!)!.p.id, (merged.get(byProduct.get(n.productId!)!.p.id) ?? 0) + n.qty);
    await db.insert(s.basketLine).values(
      [...merged].map(([poolId, qty]) => {
        const r = priced.find((x) => x.p.id === poolId)!;
        return { id: newId("bl"), basketId: bk.id, poolId, qty, ceilingUnitCents: ceilingUnit(r.b.tiers) };
      }),
    );
  }
}

export async function poolIdsWithStatus(db: DB, cycleId: string, statuses: (typeof s.pool.$inferSelect)["status"][]) {
  return (await db.select({ id: s.pool.id }).from(s.pool).where(and(eq(s.pool.cycleId, cycleId), inArray(s.pool.status, statuses)))).map((r) => r.id);
}
