// Settlement at cutoff (Architecture §8). The only code path that captures or voids resident holds.
import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { fmt } from "../util/money";
import { gateway } from "../paypal/gateway";
import { settlePool } from "./pricing";
import { log, post } from "./ledger";
import { recordTrust } from "./trust";

export async function settleCycle(db: DB, cycleId: string, actor: string): Promise<string> {
  const gw = gateway();
  const baskets = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, cycleId), inArray(s.basket.status, ["AUTHORIZED", "DRAFT", "AWAITING_APPROVAL", "WITHDRAWN"])));

  // Unconfirmed baskets never had a hold: their lines are released, nothing to charge.
  for (const b of baskets.filter((b) => b.status !== "AUTHORIZED")) {
    await db.update(s.basketLine).set({ status: "released" }).where(eq(s.basketLine.basketId, b.id));
    if (b.status === "AWAITING_APPROVAL") await db.update(s.payment).set({ status: "SUPERSEDED" }).where(and(eq(s.payment.basketId, b.id), eq(s.payment.status, "CREATED")));
  }
  const held = baskets.filter((b) => b.status === "AUTHORIZED");

  // 1) Dry run: confirm every hold is still valid before anyone is charged (Architecture §8 edge cases).
  const payments = new Map<string, typeof s.payment.$inferSelect>();
  let failedHolds = 0;
  for (const b of held) {
    const [p] = await db.select().from(s.payment).where(and(eq(s.payment.basketId, b.id), eq(s.payment.status, "AUTHORIZED")));
    let ok = Boolean(p?.paypalAuthorizationId);
    if (ok) {
      try {
        const a = await gw.getAuthorization(p.paypalAuthorizationId!);
        ok = a.status === "CREATED" || a.status === "PENDING";
      } catch {
        ok = false;
      }
    }
    if (ok) payments.set(b.id, p);
    else {
      failedHolds++;
      await db.update(s.basket).set({ status: "PAYMENT_FAILED" }).where(eq(s.basket.id, b.id));
      await db.update(s.basketLine).set({ status: "released" }).where(eq(s.basketLine.basketId, b.id));
    }
  }

  // 2) Settle each priced pool with only valid holds.
  const pools = await db.select({ p: s.pool, b: s.bid, prod: s.product }).from(s.pool).innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id)).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(and(eq(s.pool.cycleId, cycleId), eq(s.pool.status, "PRICED")));
  let succeeded = 0;
  let failed = 0;
  for (const { p, b, prod } of pools) {
    const lines = await db
      .select({ l: s.basketLine, authorizedAt: s.basket.authorizedAt })
      .from(s.basketLine)
      .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
      .where(and(eq(s.basketLine.poolId, p.id), eq(s.basketLine.status, "committed"), eq(s.basket.status, "AUTHORIZED")));
    const out = settlePool(b, lines.map(({ l, authorizedAt }) => ({ id: l.id, qty: l.qty, authorizedAt: authorizedAt?.getTime() ?? 0 })));
    if (out.released.length) await db.update(s.basketLine).set({ status: "released" }).where(inArray(s.basketLine.id, out.released));
    if (out.status === "SUCCEEDED") {
      succeeded++;
      await db.update(s.basketLine).set({ status: "won", finalUnitCents: out.finalUnitCents }).where(inArray(s.basketLine.id, out.kept));
      await db.update(s.pool).set({ status: "SUCCEEDED", finalUnitCents: out.finalUnitCents, keptQty: out.keptQty }).where(eq(s.pool.id, p.id));
      await log(db, cycleId, "settlement", "money", `${prod.title}: ${out.keptQty} packs reached ${fmt(out.finalUnitCents)}/pack (ceiling was ${fmt(b.tiers[0].unitCents)}).`);
    } else {
      failed++;
      await db.update(s.pool).set({ status: "FAILED", keptQty: 0 }).where(eq(s.pool.id, p.id));
      await log(db, cycleId, "settlement", "money", `${prod.title}: didn't reach MOQ ${b.moq}; nobody is charged for it.`);
    }
  }

  // 3) One capture (or void) per held basket. A failure on one basket never blocks the others.
  let capturedTotal = 0;
  let heldTotal = 0;
  let voided = 0;
  for (const b of held) {
    const pay = payments.get(b.id);
    if (!pay) continue;
    heldTotal += pay.authorizedCents;
    // Seller comes from the DB (not this run's memory) so a re-run after a partial failure is correct.
    const won = await db
      .select({ l: s.basketLine, sellerId: s.bid.sellerId })
      .from(s.basketLine)
      .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
      .innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
      .where(and(eq(s.basketLine.basketId, b.id), eq(s.basketLine.status, "won")));
    const total = won.reduce((sum, { l }) => sum + l.qty * (l.finalUnitCents ?? 0), 0);
    if (total === 0) {
      try {
        await gw.voidAuthorization(pay.paypalAuthorizationId!);
        await db.update(s.payment).set({ status: "VOIDED" }).where(eq(s.payment.id, pay.id));
        await db.update(s.basket).set({ status: "RELEASED" }).where(eq(s.basket.id, b.id));
        voided++;
      } catch (e) {
        console.error(`[settlement] void failed for ${b.id}`, e);
        await log(db, cycleId, "settlement", "money", `Couldn't release one unused hold right away; nothing was charged and PayPal expires it automatically. (${e instanceof Error ? e.message : e})`);
      }
      continue;
    }
    try {
      if (total > pay.authorizedCents) throw new Error(`Invariant violated: capture ${total} > hold ${pay.authorizedCents} for basket ${b.id}`); // Policies §1.3
      const cap = await gw.capture({ authorizationId: pay.paypalAuthorizationId!, cents: total, finalCapture: true, invoiceId: `${b.id}-${cycleId}` });
      capturedTotal += total;
      const perSeller = new Map<string, number>();
      for (const { l, sellerId } of won) perSeller.set(sellerId, (perSeller.get(sellerId) ?? 0) + l.qty * l.finalUnitCents!);
      // Record the capture atomically: a crash halfway must not leave a paid basket looking unpaid.
      await db.transaction(async (tx) => {
        await tx.update(s.payment).set({ status: "CAPTURED", paypalCaptureId: cap.captureId, capturedCents: total, paypalFeeCents: cap.feeCents }).where(eq(s.payment.id, pay.id));
        await tx.update(s.basket).set({ status: "CAPTURED", capturedCents: total }).where(eq(s.basket.id, b.id));
        await post(tx, {
          cycleId,
          memo: `Capture ${b.id}`,
          refType: "payment",
          refId: pay.id,
          legs: [{ account: "paypal_clearing", debit: total }, ...[...perSeller].map(([sellerId, cents]) => ({ account: "seller_payable" as const, credit: cents, sellerId }))],
        });
        if (cap.feeCents) await post(tx, { cycleId, memo: `PayPal fee ${b.id}`, refType: "payment", refId: pay.id, legs: [{ account: "platform_expense", debit: cap.feeCents }, { account: "paypal_clearing", credit: cap.feeCents }] });
        await recordTrust(tx, { subjectType: "household", subjectId: b.householdId, cycleId, kind: "commitment_kept", refId: pay.id });
      });
    } catch (e) {
      console.error(`[settlement] capture failed for ${b.id}`, e);
      await db.update(s.basket).set({ status: "PAYMENT_FAILED" }).where(eq(s.basket.id, b.id));
      await db.update(s.basketLine).set({ status: "released" }).where(eq(s.basketLine.basketId, b.id));
      await recordTrust(db, { subjectType: "household", subjectId: b.householdId, cycleId, kind: "payment_failed", refId: pay.id });
      await log(db, cycleId, "settlement", "money", `Capture failed for one basket; its items were released. (${e instanceof Error ? e.message : e})`);
    }
  }
  const saved = heldTotal - capturedTotal;
  const msg = `Cutoff settled: ${succeeded} pools succeeded, ${failed} failed. Captured ${fmt(capturedTotal)} of ${fmt(heldTotal)} held (${fmt(saved)} released back to residents)${voided ? `, ${voided} holds fully voided` : ""}${failedHolds ? `, ${failedHolds} invalid holds skipped` : ""}.`;
  await log(db, cycleId, actor, "phase", msg);
  return msg;
}
