// Read models for the pages. Pure reads; all writes go through app/actions.ts → lib/engine.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "./db";
import * as s from "./db/schema";
import { SOCIETY_ID } from "./db/seed";
import { currentCycle } from "./engine/cycle";
import { poolQuantities } from "./engine/basket";
import { nextTier, unitPriceAt } from "./engine/pricing";

export type PoolView = Awaited<ReturnType<typeof poolsView>>[number];

export async function poolsView(db: DB, cycleId: string) {
  const rows = await db
    .select({ p: s.pool, prod: s.product, b: s.bid, seller: s.seller })
    .from(s.pool)
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .leftJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .leftJoin(s.seller, eq(s.bid.sellerId, s.seller.id))
    .where(eq(s.pool.cycleId, cycleId))
    .orderBy(desc(s.pool.demandEstimate));
  const qty = await poolQuantities(db, cycleId);
  const bidCounts = await db
    .select({ poolId: s.bid.poolId, n: sql<number>`count(*)::int` })
    .from(s.bid)
    .innerJoin(s.pool, eq(s.bid.poolId, s.pool.id))
    .where(and(eq(s.pool.cycleId, cycleId), inArray(s.bid.status, ["submitted", "won", "lost"])))
    .groupBy(s.bid.poolId);
  const counts = new Map(bidCounts.map((r) => [r.poolId, r.n]));
  return rows.map(({ p, prod, b, seller }) => {
    const q = qty.get(p.id) ?? { committed: 0, pending: 0, households: 0 };
    const committed = p.keptQty ?? q.committed;
    const current = b ? unitPriceAt(b.tiers, committed) : null;
    return {
      id: p.id,
      status: p.status,
      product: { ...prod, title: prod.brand ? `${prod.title} (${prod.brand})` : prod.title },
      demand: p.demandEstimate,
      aiNotes: p.aiNotes,
      bids: counts.get(p.id) ?? 0,
      winning: b ? { ...b, sellerName: seller?.businessName ?? "" } : null,
      committed,
      pending: q.pending,
      households: q.households,
      currentUnit: p.finalUnitCents ?? current,
      ceilingUnit: b?.tiers[0].unitCents ?? null,
      next: b ? nextTier(b.tiers, committed) : null,
      finalUnit: p.finalUnitCents,
      savingsPct: b ? Math.round((1 - (p.finalUnitCents ?? current ?? b.tiers[0].unitCents) / prod.retailRefCents) * 100) : null,
    };
  });
}

export async function societyContext(db: DB) {
  const [society] = await db.select().from(s.society).where(eq(s.society.id, SOCIETY_ID));
  const cycle = await currentCycle(db, SOCIETY_ID);
  return { society, cycle };
}

export async function basketView(db: DB, cycleId: string, householdId: string) {
  const [basket] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, cycleId), eq(s.basket.householdId, householdId)));
  if (!basket) return null;
  const lines = await db
    .select({ l: s.basketLine, prod: s.product, p: s.pool })
    .from(s.basketLine)
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .where(eq(s.basketLine.basketId, basket.id));
  const payments = await db.select().from(s.payment).where(eq(s.payment.basketId, basket.id)).orderBy(desc(s.payment.createdAt));
  const issues = lines.length
    ? await db.select().from(s.issue).where(inArray(s.issue.basketLineId, lines.map((x) => x.l.id)))
    : [];
  const refunds = payments.length ? await db.select().from(s.refund).where(inArray(s.refund.paymentId, payments.map((p) => p.id))).orderBy(s.refund.createdAt) : [];
  return { basket, lines, payments, issues, refunds };
}

export async function needsView(db: DB, cycleId: string, householdId: string) {
  return db
    .select({ n: s.need, prod: s.product })
    .from(s.need)
    .leftJoin(s.product, eq(s.need.productId, s.product.id))
    .where(and(eq(s.need.cycleId, cycleId), eq(s.need.householdId, householdId), eq(s.need.status, "active")))
    .orderBy(desc(s.need.createdAt));
}

export async function activityFeed(db: DB, cycleId: string | null, limit = 12) {
  return db
    .select()
    .from(s.activity)
    .where(cycleId ? sql`${s.activity.cycleId} = ${cycleId} or ${s.activity.cycleId} is null` : undefined)
    .orderBy(desc(s.activity.createdAt))
    .limit(limit);
}

export async function cycleMoney(db: DB, cycleId: string) {
  const [r] = await db
    .select({
      held: sql<number>`coalesce(sum(case when ${s.payment.status} in ('AUTHORIZED','CAPTURED','VOIDED') then ${s.payment.authorizedCents} else 0 end),0)::int`,
      activeHolds: sql<number>`coalesce(sum(case when ${s.payment.status} = 'AUTHORIZED' then ${s.payment.authorizedCents} else 0 end),0)::int`,
      captured: sql<number>`coalesce(sum(${s.payment.capturedCents}),0)::int`,
      fees: sql<number>`coalesce(sum(${s.payment.paypalFeeCents}),0)::int`,
      holders: sql<number>`count(distinct case when ${s.payment.status} in ('AUTHORIZED','CAPTURED') then ${s.payment.basketId} end)::int`,
    })
    .from(s.payment)
    .innerJoin(s.basket, eq(s.payment.basketId, s.basket.id))
    .where(eq(s.basket.cycleId, cycleId));
  const [ref] = await db
    .select({ cents: sql<number>`coalesce(sum(${s.refund.amountCents}),0)::int` })
    .from(s.refund)
    .innerJoin(s.payment, eq(s.refund.paymentId, s.payment.id))
    .innerJoin(s.basket, eq(s.payment.basketId, s.basket.id))
    .where(eq(s.basket.cycleId, cycleId));
  const [retail] = await db
    .select({ cents: sql<number>`coalesce(sum(${s.basketLine.qty} * ${s.product.retailRefCents}),0)::int`, paid: sql<number>`coalesce(sum(${s.basketLine.qty} * ${s.basketLine.finalUnitCents}),0)::int` })
    .from(s.basketLine)
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .where(and(eq(s.basket.cycleId, cycleId), inArray(s.basketLine.status, ["won", "refunded_partial", "refunded_full"])));
  return { ...r, refunds: ref.cents, retailEquivalent: retail.cents, paidForGoods: retail.paid, savings: retail.cents - retail.paid };
}
