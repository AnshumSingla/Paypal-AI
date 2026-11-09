// Seller payouts after the issue window (Policies §11). One PayPal Payouts batch per cycle,
// one item per seller; sender ids make retries safe.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";
import { bps, fmt } from "../util/money";
import { gateway } from "../paypal/gateway";
import { log, post } from "./ledger";

export async function sellerStatement(db: DB, cycleId: string) {
  const won = await db
    .select({ sellerId: s.bid.sellerId, bps: s.bid.commissionBps, gross: sql<number>`coalesce(sum(${s.basketLine.qty} * ${s.basketLine.finalUnitCents}),0)::int` })
    .from(s.basketLine)
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .where(and(eq(s.pool.cycleId, cycleId), inArray(s.basketLine.status, ["won", "refunded_partial", "refunded_full"])))
    .groupBy(s.bid.sellerId, s.bid.commissionBps, s.bid.id);
  const refunds = await db
    .select({ sellerId: s.refund.sellerId, cents: sql<number>`coalesce(sum(${s.refund.amountCents}),0)::int` })
    .from(s.refund)
    .innerJoin(s.issue, eq(s.refund.issueId, s.issue.id))
    .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .where(and(eq(s.basket.cycleId, cycleId), eq(s.refund.chargedTo, "seller")))
    .groupBy(s.refund.sellerId);
  const bySeller = new Map<string, { gross: number; commission: number; refunds: number }>();
  for (const w of won) {
    const e = bySeller.get(w.sellerId) ?? { gross: 0, commission: 0, refunds: 0 };
    e.gross += w.gross;
    e.commission += bps(w.gross, w.bps ?? 800);
    bySeller.set(w.sellerId, e);
  }
  for (const r of refunds) if (r.sellerId && bySeller.has(r.sellerId)) bySeller.get(r.sellerId)!.refunds += r.cents;
  return bySeller;
}

export async function processPayouts(db: DB, cycleId: string, actor: string): Promise<string> {
  const existing = await db.select().from(s.payout).where(eq(s.payout.cycleId, cycleId));
  if (existing.length) return "Payouts already processed for this cycle.";
  const statement = await sellerStatement(db, cycleId);
  const items: { receiver: string; cents: number; senderItemId: string; note: string; payoutId: string; sellerId: string }[] = [];
  const lines: string[] = [];
  for (const [sellerId, e] of statement) {
    const [sel] = await db.select().from(s.seller).where(eq(s.seller.id, sellerId));
    const carried = Math.min(0, sel.balanceCents);
    const net = e.gross - e.commission - e.refunds + carried;
    const payoutId = newId("po");
    const senderItemId = `${cycleId}:${sellerId}`;
    if (e.commission) await post(db, { cycleId, memo: `Commission ${sel.businessName}`, refType: "payout", refId: payoutId, legs: [{ account: "seller_payable", debit: e.commission, sellerId }, { account: "platform_revenue", credit: e.commission }] });
    if (net <= 0) {
      await db.insert(s.payout).values({ id: payoutId, cycleId, sellerId, grossCents: e.gross, commissionCents: e.commission, refundsCents: e.refunds, carriedCents: carried, netCents: net, senderItemId, status: "CARRIED_FORWARD" });
      await db.update(s.seller).set({ balanceCents: net }).where(eq(s.seller.id, sellerId));
      lines.push(`${sel.businessName}: ${fmt(net)} carried forward`);
      continue;
    }
    await db.insert(s.payout).values({ id: payoutId, cycleId, sellerId, grossCents: e.gross, commissionCents: e.commission, refundsCents: e.refunds, carriedCents: carried, netCents: net, senderItemId, status: "PENDING" });
    items.push({ receiver: sel.payoutEmail, cents: net, senderItemId, note: `PoolCart ${cycleId}: gross ${fmt(e.gross)} − commission ${fmt(e.commission)} − refunds ${fmt(e.refunds)}`, payoutId, sellerId });
    lines.push(`${sel.businessName}: ${fmt(net)} (gross ${fmt(e.gross)}, commission ${fmt(e.commission)}, refunds ${fmt(e.refunds)})`);
  }
  if (items.length) {
    try {
      // Cycle ids repeat after a demo reset, so the batch id also carries a fresh payout id.
      const r = await gateway().payout({ senderBatchId: `poolcart-${cycleId}-${items[0].payoutId}`, items });
      for (const i of items) {
        await db.update(s.payout).set({ status: r.status === "SUCCESS" ? "SUCCESS" : "SENT", paypalBatchId: r.batchId }).where(eq(s.payout.id, i.payoutId));
        await db.update(s.seller).set({ balanceCents: 0 }).where(eq(s.seller.id, i.sellerId));
        await post(db, { cycleId, memo: `Payout ${i.senderItemId}`, refType: "payout", refId: i.payoutId, legs: [{ account: "seller_payable", debit: i.cents, sellerId: i.sellerId }, { account: "paypal_clearing", credit: i.cents }] });
      }
    } catch (e) {
      for (const i of items) await db.update(s.payout).set({ status: "FAILED" }).where(eq(s.payout.id, i.payoutId));
      await log(db, cycleId, actor, "money", `Payout batch failed: ${e instanceof Error ? e.message : e}. Sellers can retry from their portal after fixing payout details.`);
      return `Payout batch failed: ${e instanceof Error ? e.message : e}`;
    }
  }
  const msg = `Seller payouts sent via PayPal Payouts. ${lines.join("; ") || "No sellers to pay."}`;
  await log(db, cycleId, actor, "phase", msg);
  return msg;
}

/** Retry a failed payout with the same sender_item_id (idempotent on PayPal's side). */
export async function retryPayout(db: DB, payoutId: string, actor: string) {
  const [po] = await db.select().from(s.payout).where(eq(s.payout.id, payoutId));
  if (!po || po.status !== "FAILED") return;
  const [sel] = await db.select().from(s.seller).where(eq(s.seller.id, po.sellerId));
  const r = await gateway().payout({ senderBatchId: `poolcart-${po.cycleId}-retry-${po.id}`, items: [{ receiver: sel.payoutEmail, cents: po.netCents, senderItemId: po.senderItemId, note: "PoolCart payout (retry)" }] });
  await db.update(s.payout).set({ status: r.status === "SUCCESS" ? "SUCCESS" : "SENT", paypalBatchId: r.batchId }).where(eq(s.payout.id, payoutId));
  await db.update(s.seller).set({ balanceCents: 0 }).where(eq(s.seller.id, po.sellerId));
  await post(db, { cycleId: po.cycleId, memo: `Payout ${po.senderItemId}`, refType: "payout", refId: payoutId, legs: [{ account: "seller_payable", debit: po.netCents, sellerId: po.sellerId }, { account: "paypal_clearing", credit: po.netCents }] });
  await log(db, po.cycleId, actor, "money", `Payout retried for ${sel.businessName}: ${fmt(po.netCents)}.`);
}
