// Pure pricing rules (Policies §2). No I/O, fully unit-tested.
import type { Tier } from "../db/schema";

export class PolicyError extends Error {}

/** Validate a seller's tier sheet: 1–5 tiers, first min = MOQ, ascending qty, strictly falling price. */
export function validateTiers(moq: number, maxCapacity: number, tiers: Tier[]) {
  if (!Number.isInteger(moq) || moq < 1) throw new PolicyError("MOQ must be a whole number of at least 1.");
  if (!Number.isInteger(maxCapacity) || maxCapacity < moq) throw new PolicyError("Max capacity must be at least the MOQ.");
  if (tiers.length < 1 || tiers.length > 5) throw new PolicyError("Use between 1 and 5 price tiers.");
  if (tiers[0].minQty !== moq) throw new PolicyError("The first tier must start at the MOQ.");
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (!Number.isInteger(t.minQty) || !Number.isInteger(t.unitCents) || t.unitCents <= 0) throw new PolicyError("Tier quantities and prices must be positive whole numbers.");
    if (i > 0 && t.minQty <= tiers[i - 1].minQty) throw new PolicyError("Tier quantities must increase.");
    if (i > 0 && t.unitCents >= tiers[i - 1].unitCents) throw new PolicyError("Each deeper tier must be cheaper than the one before.");
    if (t.minQty > maxCapacity) throw new PolicyError("A tier can't start above max capacity.");
  }
}

/** Ceiling = the price at MOQ (tier 1): what the resident's PayPal hold covers. */
export const ceilingUnit = (tiers: Tier[]) => tiers[0].unitCents;

/** Unit price for a total quantity, or null when below MOQ. */
export function unitPriceAt(tiers: Tier[], qty: number): number | null {
  let price: number | null = null;
  for (const t of tiers) if (qty >= t.minQty) price = t.unitCents;
  return price;
}

/** Next price break above the current quantity, for "N more → $X" nudges. */
export function nextTier(tiers: Tier[], qty: number): { needed: number; unitCents: number } | null {
  const t = tiers.find((x) => x.minQty > qty);
  return t ? { needed: t.minQty - qty, unitCents: t.unitCents } : null;
}

/** Landed cost per unit at a projected quantity (used to rank bids; below MOQ counts as tier 1). */
export const projectedUnit = (tiers: Tier[], projectedQty: number) => unitPriceAt(tiers, projectedQty) ?? tiers[0].unitCents;

export type LineIn = { id: string; qty: number; authorizedAt: number };
export type PoolOutcome =
  | { status: "FAILED"; keptQty: 0; finalUnitCents: null; kept: string[]; released: string[] }
  | { status: "SUCCEEDED"; keptQty: number; finalUnitCents: number; kept: string[]; released: string[] };

/**
 * Settle one pool (Architecture §8, Policies §5): below MOQ → FAILED (all released);
 * above capacity → keep whole lines first-committed-first-served; price = tier reached by kept qty.
 */
export function settlePool(bid: { moq: number; maxCapacity: number; tiers: Tier[] }, lines: LineIn[]): PoolOutcome {
  const ordered = [...lines].sort((a, b) => a.authorizedAt - b.authorizedAt || a.id.localeCompare(b.id));
  const total = ordered.reduce((s, l) => s + l.qty, 0);
  if (total < bid.moq) return { status: "FAILED", keptQty: 0, finalUnitCents: null, kept: [], released: ordered.map((l) => l.id) };
  const kept: string[] = [];
  const released: string[] = [];
  let keptQty = 0;
  for (const l of ordered) {
    if (keptQty + l.qty <= bid.maxCapacity) {
      kept.push(l.id);
      keptQty += l.qty;
    } else released.push(l.id);
  }
  if (keptQty < bid.moq) return { status: "FAILED", keptQty: 0, finalUnitCents: null, kept: [], released: ordered.map((l) => l.id) };
  return { status: "SUCCEEDED", keptQty, finalUnitCents: unitPriceAt(bid.tiers, keptQty)!, kept, released };
}

export const COMMISSION_BPS = { starter: 800, pro: 400, partner: 250 } as const;
export const PLAN_PRICES_CENTS = { starter: 0, pro: 1900, partner: 4900 } as const;
export const AUTO_REFUND_LIMIT_CENTS = 1000; // Policies §8.3
export const HONOR_PERIOD_MS = 72 * 3600 * 1000; // Policies §1.4
