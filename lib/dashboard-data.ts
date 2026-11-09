// Flat tables for the AG Studio dashboard (amounts in dollars, as AG Studio's currency format expects).
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { trustScores } from "./engine/trust";
import type { DB } from "./db";
import * as s from "./db/schema";

const d = (c: number | null | undefined) => (c ?? 0) / 100;

export async function dashboardData(db: DB) {
  const lineRows = await db
    .select({ l: s.basketLine, bk: s.basket, c: s.cycle, p: s.pool, prod: s.product, hh: s.household, bid: s.bid, sel: s.seller })
    .from(s.basketLine)
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .innerJoin(s.cycle, eq(s.basket.cycleId, s.cycle.id))
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .innerJoin(s.household, eq(s.basket.householdId, s.household.id))
    .leftJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .leftJoin(s.seller, eq(s.bid.sellerId, s.seller.id));
  const lines = lineRows
    .filter((r) => r.l.status !== "draft")
    .map(({ l, c, prod, hh, sel }) => {
      const won = ["won", "refunded_partial", "refunded_full"].includes(l.status);
      const paid = won ? l.qty * (l.finalUnitCents ?? 0) : 0;
      const retail = won ? l.qty * prod.retailRefCents : 0;
      return {
        id: l.id,
        week: c.weekLabel,
        product: prod.title,
        category: prod.category,
        seller: sel?.businessName ?? "—",
        unit: hh.unitLabel,
        outcome: won ? "Charged" : "Released (not charged)",
        qty: l.qty,
        held: d(l.qty * l.ceilingUnitCents),
        paid: d(paid),
        retail: d(retail),
        savings: d(retail - paid),
        refunded: d(l.refundedCents),
      };
    });

  const poolRows = await db.select({ p: s.pool, c: s.cycle, prod: s.product }).from(s.pool).innerJoin(s.cycle, eq(s.pool.cycleId, s.cycle.id)).innerJoin(s.product, eq(s.pool.productId, s.product.id));
  const pools = poolRows.map(({ p, c, prod }) => ({
    id: p.id,
    week: c.weekLabel,
    product: prod.title,
    status: p.status,
    demand: p.demandEstimate,
    keptQty: p.keptQty ?? 0,
    finalUnit: d(p.finalUnitCents),
    retailUnit: d(prod.retailRefCents),
    poolCount: 1,
    succeeded: ["SUCCEEDED", "DELIVERED"].includes(p.status) ? 1 : 0,
    settled: ["SUCCEEDED", "DELIVERED", "FAILED", "NO_BID"].includes(p.status) ? 1 : 0,
  }));

  const payoutRows = await db.select({ po: s.payout, c: s.cycle, sel: s.seller }).from(s.payout).innerJoin(s.cycle, eq(s.payout.cycleId, s.cycle.id)).innerJoin(s.seller, eq(s.payout.sellerId, s.seller.id));
  const payouts = payoutRows.map(({ po, c, sel }) => ({ id: po.id, week: c.weekLabel, seller: sel.businessName, plan: sel.plan, gross: d(po.grossCents), commission: d(po.commissionCents), refunds: d(po.refundsCents), net: d(po.netCents), status: po.status }));

  const payRows = await db.select({ p: s.payment, c: s.cycle }).from(s.payment).innerJoin(s.basket, eq(s.payment.basketId, s.basket.id)).innerJoin(s.cycle, eq(s.basket.cycleId, s.cycle.id));
  const payments = payRows
    .filter(({ p }) => p.status !== "SUPERSEDED" && p.status !== "CREATED")
    .map(({ p, c }) => ({ id: p.id, week: c.weekLabel, method: p.method === "card" ? "Card (simulated neighbour)" : "PayPal wallet", mode: p.mode, status: p.status, held: d(p.authorizedCents), captured: d(p.capturedCents), released: p.status === "CAPTURED" || p.status === "VOIDED" ? d(p.authorizedCents - p.capturedCents) : 0, fee: d(p.paypalFeeCents) }));

  const suppliers = await db.select().from(s.seller).where(eq(s.seller.status, "approved"));
  const scores = await trustScores(db, "seller", suppliers.map((x) => x.id));
  const counts = await db
    .select({ id: s.trustEvent.subjectId, kind: s.trustEvent.kind, n: sql<number>`sum(${s.trustEvent.weight})::int` })
    .from(s.trustEvent)
    .where(eq(s.trustEvent.subjectType, "seller"))
    .groupBy(s.trustEvent.subjectId, s.trustEvent.kind);
  const count = (id: string, kind: string) => counts.find((c) => c.id === id && c.kind === kind)?.n ?? 0;
  // Complaints carry weight 3 each in the trust score; show the number of complaints here.
  const trust = suppliers.map((x) => ({ supplier: x.businessName, trust: scores.get(x.id) ?? 0, delivered: count(x.id, "delivered"), issues: Math.round(count(x.id, "issue_upheld") / 3) }));

  // Charts group by week in the order rows arrive, so put every table in week order.
  const wk = (x: { week: string }) => Number(x.week.replace(/D/g, "")) || 0;
  const byWeek = <T extends { week: string }>(rows: T[]) => [...rows].sort((a, b) => wk(a) - wk(b));
  return { lines: byWeek(lines), pools: byWeek(pools), payouts: byWeek(payouts), payments: byWeek(payments), trust, asOf: new Date().toISOString() };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;
