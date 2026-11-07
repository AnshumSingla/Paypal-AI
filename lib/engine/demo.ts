// Demo-only helpers (DEMO_MODE=true): simulated neighbours and competing sellers, reset, next week.
// Simulated neighbours place real sandbox card holds when PayPal keys are set (Architecture §14).
import { and, eq, notInArray, sql } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";
import { CATALOG, DEMAND_PROFILE, rng, seed, SOCIETY_ID, weekDeadlines } from "../db/seed";
import { cardCheckout, getOrCreateBasket } from "./basket";
import { ceilingUnit, PolicyError } from "./pricing";
import { submitBid } from "./cycle";
import { log } from "./ledger";

export const demoMode = () => process.env.DEMO_MODE !== "false";

/** N more households confirm baskets from the priced pools (COMMIT phase). */
export async function simulateNeighbours(db: DB, cycleId: string, count: number, actor = "demo") {
  const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, cycleId));
  if (c.phase !== "COMMIT") throw new PolicyError("Simulated neighbours join during Confirm & pay.");
  const priced = await db.select({ p: s.pool, b: s.bid }).from(s.pool).innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id)).where(and(eq(s.pool.cycleId, cycleId), eq(s.pool.status, "PRICED")));
  if (!priced.length) throw new PolicyError("No priced pools to join.");
  const personaHouseholds = (await db.select({ h: s.appUser.householdId }).from(s.appUser).where(eq(s.appUser.isPersona, true))).map((r) => r.h).filter(Boolean) as string[];
  // Prefer households with an unconfirmed draft basket, then households with no basket.
  const drafts = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, cycleId), eq(s.basket.status, "DRAFT"), notInArray(s.basket.householdId, personaHouseholds.length ? personaHouseholds : ["-"])));
  const withBasket = (await db.select({ h: s.basket.householdId }).from(s.basket).where(eq(s.basket.cycleId, cycleId))).map((r) => r.h);
  const fresh = await db.select().from(s.household).where(and(eq(s.household.societyId, c.societyId), notInArray(s.household.id, [...withBasket, ...personaHouseholds, "-"])));
  const rand = rng(Date.now() % 100000);
  let joined = 0;
  let failed = 0;
  const targets = [...drafts.map((d) => d.householdId), ...fresh.map((h) => h.id)].slice(0, count);
  for (const householdId of targets) {
    const bk = await getOrCreateBasket(db, cycleId, householdId);
    const existing = await db.select().from(s.basketLine).where(eq(s.basketLine.basketId, bk.id));
    if (!existing.length) {
      const picks = priced.filter((r) => {
        const prof = DEMAND_PROFILE.find(([pid]) => pid === r.p.productId);
        return rand() < (prof?.[1] ?? 0.3);
      });
      const chosen = picks.length ? picks : [priced[Math.floor(rand() * priced.length)]];
      await db.insert(s.basketLine).values(
        chosen.map((r) => {
          const prof = DEMAND_PROFILE.find(([pid]) => pid === r.p.productId);
          return { id: newId("bl"), basketId: bk.id, poolId: r.p.id, qty: 1 + Math.floor(rand() * (prof?.[2] ?? 1)), ceilingUnitCents: ceilingUnit(r.b.tiers) };
        }),
      );
    }
    await db.update(s.basket).set({ simulated: true }).where(eq(s.basket.id, bk.id));
    try {
      await cardCheckout(db, bk.id, "simulated neighbour");
      joined++;
    } catch (e) {
      failed++;
      console.error("[demo] simulated hold failed", e);
    }
  }
  await log(db, cycleId, actor, "resident", `${joined} simulated neighbours confirmed baskets with PayPal holds${failed ? ` (${failed} failed)` : ""}.`);
  return { joined, failed };
}

/** The non-persona sellers bid on every open pool so the captain has bids to compare. */
export async function simulateCompetingBids(db: DB, cycleId: string) {
  const open = await db.select({ p: s.pool, prod: s.product }).from(s.pool).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(and(eq(s.pool.cycleId, cycleId), eq(s.pool.status, "OPEN_FOR_BIDS")));
  const sellers = await db.select().from(s.seller).where(and(eq(s.seller.status, "approved"), sql`${s.seller.id} <> 'sel_fresh'`));
  const rand = rng(cycleId.length * 7919);
  let n = 0;
  for (const { p, prod } of open) {
    for (const sel of sellers) {
      const already = await db.select().from(s.bid).where(and(eq(s.bid.poolId, p.id), eq(s.bid.sellerId, sel.id), eq(s.bid.status, "submitted")));
      if (already.length || rand() < 0.15) continue;
      const r = prod.retailRefCents;
      const t1 = Math.round(r * (0.86 + rand() * 0.06));
      // Realistic sheets: MOQ ≈ 40-60% of demand, deeper tiers around and just above today's demand.
      const moq = Math.max(3, Math.round(p.demandEstimate * (0.4 + rand() * 0.2)));
      const tiers = [
        { minQty: moq, unitCents: t1 },
        { minQty: Math.max(moq + 1, Math.round(p.demandEstimate * (0.75 + rand() * 0.15))), unitCents: t1 - Math.round(r * (0.05 + rand() * 0.03)) },
        { minQty: Math.max(moq + 2, Math.round(p.demandEstimate * (1.1 + rand() * 0.2))), unitCents: t1 - Math.round(r * (0.11 + rand() * 0.04)) },
      ];
      try {
        await submitBid(db, { poolId: p.id, sellerId: sel.id, moq, maxCapacity: Math.max(tiers[2].minQty, Math.round(p.demandEstimate * 2.2)), tiers, deliveryWindow: "Sat 9:00–12:00" });
        n++;
      } catch (e) {
        console.warn(`[demo] skipped simulated bid on ${prod.title}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return n;
}

/** Wipe everything and re-seed the demo society. */
export async function resetDemo(db: DB) {
  for (const t of [s.activity, s.webhookEvent, s.aiDecision, s.ledgerEntry, s.payout, s.refund, s.issue, s.payment, s.basketLine, s.basket, s.bid, s.pool, s.need, s.cycle, s.seller, s.appUser, s.household, s.society, s.product]) {
    await db.delete(t);
  }
  await seed(db);
}

/** Open next week's cycle after the current one closed. */
export async function startNextCycle(db: DB, actor: string) {
  const [last] = await db.select().from(s.cycle).where(eq(s.cycle.societyId, SOCIETY_ID)).orderBy(sql`${s.cycle.createdAt} desc`).limit(1);
  if (last && last.phase !== "CLOSED") throw new PolicyError("Finish the current cycle first.");
  const week = last ? Number(/\d+/.exec(last.weekLabel)?.[0] ?? 46) + 1 : 46;
  const id = newId("cyc");
  await db.insert(s.cycle).values({ id, societyId: SOCIETY_ID, weekLabel: `Week ${week}`, phase: "COLLECT", deadlines: weekDeadlines() });
  // Recurring neighbours add their usual needs.
  const rand = rng(week);
  const households = await db.select().from(s.household).where(eq(s.household.societyId, SOCIETY_ID));
  const needs: (typeof s.need.$inferInsert)[] = [];
  for (const hh of households.slice(0, 26)) {
    if (hh.id === "hh_31") continue;
    for (const [productId, p, maxQty] of DEMAND_PROFILE) {
      if (rand() < p) {
        const qty = 1 + Math.floor(rand() * maxQty);
        needs.push({ id: newId("need"), cycleId: id, householdId: hh.id, rawText: `${qty} x ${CATALOG.find((c) => c.id === productId)!.title.toLowerCase()}`, productId, qty, brandFlexible: rand() < 0.6, source: "simulated" });
      }
    }
  }
  if (needs.length) await db.insert(s.need).values(needs);
  await log(db, id, actor, "phase", `Week ${week} opened.`);
  return id;
}
