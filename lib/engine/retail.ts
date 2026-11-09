// Retail reference prices from Channel3, so "saved against retail" is measured against what the
// same product sells for today instead of a number typed into the seed.
import { eq, inArray, not } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { channel3Enabled, channel3Search } from "../channel3";
import { fmt } from "../util/money";
import { PolicyError } from "./pricing";
import { log } from "./ledger";

/**
 * Pure: the retail price to use from Channel3's results, or null to keep the current one.
 * Takes the lower median, so one overpriced listing can't inflate residents' savings, and ignores
 * results far from the current price, which are usually a different pack size or product.
 */
export function pickRetailCents(currentCents: number, foundCents: (number | null)[]): number | null {
  const prices = foundCents.filter((n): n is number => typeof n === "number" && n > 0).sort((a, b) => a - b);
  if (!prices.length) return null;
  const median = prices[Math.floor((prices.length - 1) / 2)];
  if (median < currentCents * 0.5 || median > currentCents * 2) return null;
  return median;
}

/** Check every catalog product against Channel3. Only while no supplier has bid against today's prices. */
export async function refreshRetailPrices(db: DB, actor: string) {
  if (!channel3Enabled()) throw new PolicyError("Add a Channel3 API key to check retail prices.");
  const busy = await db.select({ id: s.cycle.id }).from(s.cycle).where(not(inArray(s.cycle.phase, ["COLLECT", "CLOSED"])));
  if (busy.length) throw new PolicyError("Retail prices can change only before suppliers bid. Check them at the start of next week.");

  const products = await db.select().from(s.product).where(eq(s.product.restricted, false));
  const changes: string[] = [];
  let checked = 0;
  for (let i = 0; i < products.length; i += 5) {
    await Promise.all(
      products.slice(i, i + 5).map(async (p) => {
        const results = await channel3Search([p.brand, p.title, p.packSize].filter(Boolean).join(" "), 5).catch(() => []);
        if (results.length) checked++;
        const cents = pickRetailCents(p.retailRefCents, results.map((r) => r.priceCents));
        if (cents === null) return;
        await db.update(s.product).set({ retailRefCents: cents, retailSource: "channel3", channel3Id: results[0].id }).where(eq(s.product.id, p.id));
        if (cents !== p.retailRefCents) changes.push(`${p.title} ${fmt(p.retailRefCents)} → ${fmt(cents)}`);
      }),
    );
  }
  const msg = `Channel3 checked ${checked} of ${products.length} products. ${changes.length ? `Updated: ${changes.join("; ")}.` : "No retail price changed."}`;
  await log(db, null, actor, "system", msg);
  return msg;
}
