// Resident basket: edit lines during COMMIT, place one PayPal hold for the ceiling, withdraw before cutoff.
import { and, eq, ne, sql } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";
import { fmt } from "../util/money";
import { gateway, PayPalError } from "../paypal/gateway";
import { ceilingUnit, HONOR_PERIOD_MS, PolicyError } from "./pricing";
import { log } from "./ledger";

const AUTH_VALIDITY_MS = 29 * 24 * 3600 * 1000;

async function cycleOf(db: DB, cycleId: string) {
  const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, cycleId));
  if (!c) throw new PolicyError("Cycle not found.");
  return c;
}

export async function getOrCreateBasket(db: DB, cycleId: string, householdId: string) {
  await db.insert(s.basket).values({ id: newId("bsk"), cycleId, householdId }).onConflictDoNothing();
  const [b] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, cycleId), eq(s.basket.householdId, householdId)));
  return b;
}

/** Any edit to a held basket voids the hold first (Policies §1.6): the resident re-confirms. */
async function releaseHoldForEdit(db: DB, basketId: string, actor: string) {
  const [b] = await db.select().from(s.basket).where(eq(s.basket.id, basketId));
  if (b.status === "AUTHORIZED") {
    await voidBasketHold(db, basketId);
    await db.update(s.basket).set({ status: "DRAFT", authorizedAt: null }).where(eq(s.basket.id, basketId));
    await db.update(s.basketLine).set({ status: "draft" }).where(eq(s.basketLine.basketId, basketId));
    await log(db, b.cycleId, actor, "money", `Basket edited after confirming: previous PayPal hold of ${fmt(b.ceilingCents)} voided; needs re-confirming.`);
  } else if (b.status === "AWAITING_APPROVAL") {
    await db.update(s.payment).set({ status: "SUPERSEDED" }).where(and(eq(s.payment.basketId, basketId), eq(s.payment.status, "CREATED")));
    await db.update(s.basket).set({ status: "DRAFT" }).where(eq(s.basket.id, basketId));
  }
}

export async function setLineQty(db: DB, a: { cycleId: string; householdId: string; poolId: string; qty: number; actor: string }) {
  const c = await cycleOf(db, a.cycleId);
  if (c.phase !== "COMMIT") throw new PolicyError("Baskets can only be changed while the cycle is in Confirm & pay.");
  const [soc] = await db.select().from(s.society).where(eq(s.society.id, c.societyId));
  if (a.qty < 0 || a.qty > soc.maxQtyPerLine) throw new PolicyError(`Max ${soc.maxQtyPerLine} packs per item per household (Policies §4.4).`);
  const [p] = await db.select({ p: s.pool, b: s.bid }).from(s.pool).innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id)).where(eq(s.pool.id, a.poolId));
  if (!p || p.p.status !== "PRICED" || p.p.cycleId !== a.cycleId) throw new PolicyError("That pool isn't open for orders.");
  const bk = await getOrCreateBasket(db, a.cycleId, a.householdId);
  if (!["DRAFT", "AUTHORIZED", "AWAITING_APPROVAL", "WITHDRAWN"].includes(bk.status)) throw new PolicyError("This basket can't be changed now.");
  await releaseHoldForEdit(db, bk.id, a.actor);
  const [existing] = await db.select().from(s.basketLine).where(and(eq(s.basketLine.basketId, bk.id), eq(s.basketLine.poolId, a.poolId)));
  if (a.qty === 0) {
    if (existing) await db.delete(s.basketLine).where(eq(s.basketLine.id, existing.id));
  } else if (existing) {
    await db.update(s.basketLine).set({ qty: a.qty, ceilingUnitCents: ceilingUnit(p.b.tiers), status: "draft" }).where(eq(s.basketLine.id, existing.id));
  } else {
    await db.insert(s.basketLine).values({ id: newId("bl"), basketId: bk.id, poolId: a.poolId, qty: a.qty, ceilingUnitCents: ceilingUnit(p.b.tiers) });
  }
  if (bk.status === "WITHDRAWN") await db.update(s.basket).set({ status: "DRAFT" }).where(eq(s.basket.id, bk.id));
}

/** Server-side ceiling: never trust an amount from the browser. */
export async function basketCeiling(db: DB, basketId: string) {
  const lines = await db.select().from(s.basketLine).where(eq(s.basketLine.basketId, basketId));
  return { lines, cents: lines.reduce((sum, l) => sum + l.qty * l.ceilingUnitCents, 0) };
}

/** Step 1 of checkout: create the PayPal order (intent AUTHORIZE) for the ceiling amount. */
export async function startCheckout(db: DB, basketId: string, actor: string) {
  const [bk] = await db.select().from(s.basket).where(eq(s.basket.id, basketId));
  const c = await cycleOf(db, bk.cycleId);
  if (c.phase !== "COMMIT") throw new PolicyError("Checkout is only open during Confirm & pay.");
  await releaseHoldForEdit(db, basketId, actor);
  const { lines, cents } = await basketCeiling(db, basketId);
  if (!lines.length || cents <= 0) throw new PolicyError("Add at least one item first.");
  const gw = gateway();
  const { orderId } = await gw.createWalletOrder({ cents, referenceId: basketId, description: `Collective ${c.weekLabel}: ${lines.length} items (hold at max price)` });
  await db.insert(s.payment).values({ id: newId("pay"), basketId, mode: gw.mode, method: "paypal_wallet", paypalOrderId: orderId, authorizedCents: cents, status: "CREATED" });
  await db.update(s.basket).set({ status: "AWAITING_APPROVAL", ceilingCents: cents }).where(eq(s.basket.id, basketId));
  return { orderId, cents };
}

/** Step 2 of checkout (after buyer approval): authorize = place the hold. */
export async function completeCheckout(db: DB, basketId: string, orderId: string, actor: string) {
  const [pay] = await db.select().from(s.payment).where(and(eq(s.payment.basketId, basketId), eq(s.payment.paypalOrderId, orderId)));
  if (!pay || pay.status !== "CREATED") throw new PolicyError("This checkout is no longer current; please confirm again.");
  const [bk] = await db.select().from(s.basket).where(eq(s.basket.id, basketId));
  const c = await cycleOf(db, bk.cycleId);
  if (c.phase !== "COMMIT") {
    throw new PolicyError("The cutoff passed before approval completed; nothing was held.");
  }
  try {
    const auth = await gateway().authorizeOrder(orderId);
    await markAuthorized(db, basketId, pay.id, auth.authorizationId, actor);
    return auth;
  } catch (e) {
    if (e instanceof PayPalError && e.issue === "INSTRUMENT_DECLINED") {
      await db.update(s.payment).set({ status: "DECLINED" }).where(eq(s.payment.id, pay.id));
      await db.update(s.basket).set({ status: "DRAFT" }).where(eq(s.basket.id, basketId));
      throw new PolicyError("PayPal declined that payment method. Please try a different one.");
    }
    throw e;
  }
}

async function markAuthorized(db: DB, basketId: string, paymentId: string, authorizationId: string, actor: string) {
  const now = Date.now();
  await db.update(s.payment).set({ status: "AUTHORIZED", paypalAuthorizationId: authorizationId, honorExpiresAt: new Date(now + HONOR_PERIOD_MS), authExpiresAt: new Date(now + AUTH_VALIDITY_MS) }).where(eq(s.payment.id, paymentId));
  await db.update(s.basket).set({ status: "AUTHORIZED", authorizedAt: new Date(now) }).where(eq(s.basket.id, basketId));
  await db.update(s.basketLine).set({ status: "committed" }).where(eq(s.basketLine.basketId, basketId));
  const [bk] = await db.select().from(s.basket).where(eq(s.basket.id, basketId));
  await log(db, bk.cycleId, actor, "money", `PayPal hold placed: ${fmt(bk.ceilingCents)} (max price). Final charge happens at cutoff.`);
}

/** Simulated neighbour: server-side card hold (sandbox test card, or mock). */
export async function cardCheckout(db: DB, basketId: string, actor: string) {
  const { lines, cents } = await basketCeiling(db, basketId);
  if (!lines.length) return;
  const [bk] = await db.select().from(s.basket).where(eq(s.basket.id, basketId));
  const gw = gateway();
  const hold = await gw.cardHold({ cents, referenceId: basketId, description: "Collective simulated neighbour basket" });
  const paymentId = newId("pay");
  await db.insert(s.payment).values({ id: paymentId, basketId, mode: gw.mode, method: "card", paypalOrderId: hold.orderId, authorizedCents: cents, status: "CREATED" });
  await db.update(s.basket).set({ ceilingCents: cents }).where(eq(s.basket.id, bk.id));
  await markAuthorized(db, basketId, paymentId, hold.authorizationId, actor);
}

async function voidBasketHold(db: DB, basketId: string) {
  const pays = await db.select().from(s.payment).where(and(eq(s.payment.basketId, basketId), eq(s.payment.status, "AUTHORIZED")));
  for (const p of pays) {
    await gateway().voidAuthorization(p.paypalAuthorizationId!);
    await db.update(s.payment).set({ status: "VOIDED" }).where(eq(s.payment.id, p.id));
  }
}

/** Withdraw before cutoff (Policies §4.2): void the hold; lines go back to draft. */
export async function withdrawBasket(db: DB, basketId: string, actor: string) {
  const [bk] = await db.select().from(s.basket).where(eq(s.basket.id, basketId));
  const c = await cycleOf(db, bk.cycleId);
  if (c.phase !== "COMMIT") throw new PolicyError("After cutoff, orders are final (Policies §4.3).");
  await voidBasketHold(db, basketId);
  await db.update(s.basket).set({ status: "WITHDRAWN", authorizedAt: null }).where(eq(s.basket.id, basketId));
  await db.update(s.basketLine).set({ status: "draft" }).where(eq(s.basketLine.basketId, basketId));
  await log(db, bk.cycleId, actor, "money", `Basket withdrawn; PayPal hold of ${fmt(bk.ceilingCents)} voided.`);
}

/** Live pool quantities: committed (held) and pending (in unconfirmed baskets). */
export async function poolQuantities(db: DB, cycleId: string) {
  const rows = await db
    .select({
      poolId: s.basketLine.poolId,
      committed: sql<number>`coalesce(sum(case when ${s.basketLine.status} in ('committed','won','refunded_partial','refunded_full') then ${s.basketLine.qty} else 0 end),0)::int`,
      pending: sql<number>`coalesce(sum(case when ${s.basketLine.status} = 'draft' then ${s.basketLine.qty} else 0 end),0)::int`,
      households: sql<number>`count(distinct case when ${s.basketLine.status} <> 'draft' and ${s.basketLine.status} <> 'released' then ${s.basket.householdId} end)::int`,
    })
    .from(s.basketLine)
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .where(and(eq(s.basket.cycleId, cycleId), ne(s.basket.status, "WITHDRAWN")))
    .groupBy(s.basketLine.poolId);
  return new Map(rows.map((r) => [r.poolId, r]));
}

export async function markReceived(db: DB, basketId: string) {
  await db.update(s.basket).set({ receivedAt: new Date() }).where(eq(s.basket.id, basketId));
}
