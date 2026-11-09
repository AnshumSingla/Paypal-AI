// "Money on the table": during Confirm & pay, the Society Secretary goes back to a pool's winning
// supplier with funded demand (households and dollars already authorized in PayPal holds) and asks
// for a better price at the quantity the building already has. The supplier answers by its own
// pricing rule. Code decides what is allowed: a new price break can only lower prices, never below
// the supplier's floor, and the first tier (what every hold was sized on) never changes, so every
// capture still fits inside its hold.
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { fmt } from "../util/money";
import { log } from "./ledger";
import { PolicyError, unitPriceAt } from "./pricing";

// Each supplier's private lowest acceptable price, as a share of the retail reference. Demo data:
// in production this would be the supplier's own setting, never shown to the building.
const FLOOR_SHARE: Record<string, number> = { sel_fresh: 0.72, sel_valley: 0.7, sel_corner: 0.74 };
const STEP_SHARE = 0.04; // a concession is about 4% of retail per ask

export function sellerFloorCents(sellerId: string, retailRefCents: number) {
  return Math.round(retailRefCents * (FLOOR_SHARE[sellerId] ?? 0.75));
}

/** Pure: may this price break be added to a winning bid's sheet? Returns the reason it may not, or null. */
export function newTierProblem(bid: { tiers: s.Tier[]; maxCapacity: number }, tier: s.Tier, floorCents: number): string | null {
  if (!Number.isInteger(tier.minQty) || !Number.isInteger(tier.unitCents)) return "Tier quantity and price must be whole numbers.";
  if (tier.minQty <= bid.tiers[0].minQty) return `A new price break must start above the minimum order of ${bid.tiers[0].minQty}.`;
  if (bid.tiers.some((t) => t.minQty === tier.minQty)) return `There's already a price at ${tier.minQty} packs.`;
  if (tier.minQty > bid.maxCapacity) return `That's above the supplier's capacity of ${bid.maxCapacity}.`;
  if (tier.unitCents < floorCents) return "That price is below the supplier's floor.";
  if (bid.tiers.length >= 5) return "This bid already has the maximum of 5 price breaks.";
  const below = bid.tiers.filter((t) => t.minQty < tier.minQty).at(-1)!;
  const above = bid.tiers.find((t) => t.minQty > tier.minQty);
  if (tier.unitCents >= below.unitCents) return `It must be cheaper than ${fmt(below.unitCents)}, the price below it.`;
  if (above && tier.unitCents <= above.unitCents) return `It must stay above ${fmt(above.unitCents)}, the next break's price.`;
  return null;
}

/** Funded demand for one pool: committed packs, households and dollars held at the ceiling. */
export async function fundedDemand(db: DB, poolId: string) {
  const [r] = await db
    .select({
      qty: sql<number>`coalesce(sum(${s.basketLine.qty}),0)::int`,
      households: sql<number>`count(distinct ${s.basket.householdId})::int`,
      heldCents: sql<number>`coalesce(sum(${s.basketLine.qty} * ${s.basketLine.ceilingUnitCents}),0)::int`,
    })
    .from(s.basketLine)
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .where(and(eq(s.basketLine.poolId, poolId), eq(s.basketLine.status, "committed"), eq(s.basket.status, "AUTHORIZED")));
  return r;
}

/**
 * The Secretary asks the winning supplier for a better price at today's funded quantity. The
 * supplier's rule: concede one step, never below its floor, and keep its deeper breaks cheaper.
 */
export async function fundedAsk(db: DB, poolId: string, actor: string): Promise<{ accepted: boolean; message: string }> {
  const [r] = await db
    .select({ p: s.pool, b: s.bid, prod: s.product, sel: s.seller, c: s.cycle })
    .from(s.pool)
    .innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .innerJoin(s.seller, eq(s.bid.sellerId, s.seller.id))
    .innerJoin(s.cycle, eq(s.pool.cycleId, s.cycle.id))
    .where(eq(s.pool.id, poolId));
  if (!r || r.p.status !== "PRICED" || r.c.phase !== "COMMIT") throw new PolicyError("Better prices can only be asked for during Confirm & pay.");
  const demand = await fundedDemand(db, poolId);
  const current = unitPriceAt(r.b.tiers, demand.qty);
  if (!current) return { accepted: false, message: `${r.prod.title}: the building hasn't reached the minimum order yet, so there's nothing to negotiate.` };

  await log(db, r.c.id, actor, "ai", `To ${r.sel.businessName}: ${demand.households} households have ${fmt(demand.heldCents)} authorized in PayPal for ${demand.qty} packs of ${r.prod.title}. Would you lower the price at ${demand.qty} packs?`);

  const floor = sellerFloorCents(r.sel.id, r.prod.retailRefCents);
  const above = r.b.tiers.find((t) => t.minQty > demand.qty);
  const tier = { minQty: demand.qty, unitCents: Math.max(floor, current - Math.round(r.prod.retailRefCents * STEP_SHARE), (above?.unitCents ?? 0) + 1) };
  const problem = tier.unitCents < current ? newTierProblem(r.b, tier, floor) : "no room below the current price";
  if (problem) {
    const message = `${r.sel.businessName} declined for ${r.prod.title}: it's already at its lowest price for this quantity.`;
    await log(db, r.c.id, r.sel.businessName, "seller", message);
    return { accepted: false, message };
  }
  await addTier(db, r.b.id, tier, r.sel.businessName);
  return { accepted: true, message: `${r.sel.businessName} lowered ${r.prod.title} from ${fmt(current)} to ${fmt(tier.unitCents)} a pack for everyone already in.` };
}

/** Add a price break to a winning bid. Policies §2.4: prices can't rise; a supplier may add a cheaper break. */
export async function addTier(db: DB, bidId: string, tier: s.Tier, actor: string) {
  const [r] = await db.select({ b: s.bid, p: s.pool, prod: s.product }).from(s.bid).innerJoin(s.pool, eq(s.bid.poolId, s.pool.id)).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(eq(s.bid.id, bidId));
  if (!r || r.b.status !== "won" || r.p.status !== "PRICED") throw new PolicyError("Only a winning bid on an open pool can add a price break.");
  const problem = newTierProblem(r.b, tier, sellerFloorCents(r.b.sellerId, r.prod.retailRefCents));
  if (problem) throw new PolicyError(problem);
  await db.update(s.bid).set({ tiers: [...r.b.tiers, tier].sort((a, b) => a.minQty - b.minQty) }).where(eq(s.bid.id, bidId));
  await log(db, r.p.cycleId, actor, "seller", `${actor} added a tier for ${r.prod.title}: ${tier.minQty}+ packs at ${fmt(tier.unitCents)}.`);
}
