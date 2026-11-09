// "Money on the table": a supplier can only lower prices, never below its floor, the first tier
// (what holds were sized on) never changes, and every capture still fits its hold.
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.GEMINI_API_KEY = "";
process.env.GROQ_API_KEY = "";
process.env.CHANNEL3_API_KEY = "";

import { memoryDb, type DB } from "../lib/db";
import * as s from "../lib/db/schema";
import { seed } from "../lib/db/seed";
import { advance } from "../lib/engine/cycle";
import { simulateCompetingBids, simulateNeighbours } from "../lib/engine/demo";
import { addTier, fundedAsk, newTierProblem, sellerFloorCents } from "../lib/engine/negotiation";
import { runSecretary } from "../lib/ai/secretary";
import { ledgerTotals } from "../lib/engine/ledger";
import { validateTiers } from "../lib/engine/pricing";

describe("new price break rules (pure)", () => {
  const bid = { tiers: [{ minQty: 20, unitCents: 400 }, { minQty: 40, unitCents: 370 }], maxCapacity: 100 };
  it("accepts a cheaper break between or after existing ones, above the floor", () => {
    expect(newTierProblem(bid, { minQty: 30, unitCents: 385 }, 300)).toBeNull();
    expect(newTierProblem(bid, { minQty: 50, unitCents: 350 }, 300)).toBeNull();
  });
  it("rejects anything that raises a price, breaks the order, beats capacity or the floor", () => {
    expect(newTierProblem(bid, { minQty: 30, unitCents: 400 }, 300)).toMatch(/cheaper/);
    expect(newTierProblem(bid, { minQty: 30, unitCents: 370 }, 300)).toMatch(/stay above/);
    expect(newTierProblem(bid, { minQty: 20, unitCents: 350 }, 300)).toMatch(/minimum order/);
    expect(newTierProblem(bid, { minQty: 40, unitCents: 350 }, 300)).toMatch(/already/);
    expect(newTierProblem(bid, { minQty: 150, unitCents: 350 }, 300)).toMatch(/capacity/);
    expect(newTierProblem(bid, { minQty: 50, unitCents: 290 }, 300)).toMatch(/floor/);
  });
});

describe("funded asks during Confirm & pay", () => {
  let db: DB;
  const CYCLE = "cyc_w46";
  beforeAll(async () => {
    db = await memoryDb();
    await seed(db);
    await advance(db, CYCLE, "test");
    await simulateCompetingBids(db, CYCLE);
    await advance(db, CYCLE, "test");
    await simulateNeighbours(db, CYCLE, 30);
  }, 60_000);

  it("the Secretary's playbook gets lower prices that keep the sheet valid and respect floors", async () => {
    const before = await db.select({ b: s.bid, prod: s.product }).from(s.bid).innerJoin(s.pool, eq(s.bid.poolId, s.pool.id)).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(and(eq(s.pool.cycleId, CYCLE), eq(s.bid.status, "won")));
    const r = await runSecretary(db, { cycleId: CYCLE, role: "system", task: { kind: "funded_asks" } });
    expect(r.source).toBe("rules");
    const after = await db.select().from(s.bid).where(eq(s.bid.status, "won"));
    let changed = 0;
    for (const { b, prod } of before) {
      const now = after.find((x) => x.id === b.id)!;
      if (now.tiers.length === b.tiers.length) continue;
      changed++;
      expect(() => validateTiers(now.moq, now.maxCapacity, now.tiers)).not.toThrow();
      expect(now.tiers[0]).toEqual(b.tiers[0]); // the ceiling, and so every hold, is unchanged
      const added = now.tiers.find((t) => !b.tiers.some((o) => o.minQty === t.minQty))!;
      expect(added.unitCents).toBeGreaterThanOrEqual(sellerFloorCents(b.sellerId, prod.retailRefCents));
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("asking again and again stops at the supplier's floor", async () => {
    const [won] = await db.select({ b: s.bid, p: s.pool, prod: s.product }).from(s.bid).innerJoin(s.pool, eq(s.bid.poolId, s.pool.id)).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(and(eq(s.pool.cycleId, CYCLE), eq(s.bid.status, "won")));
    for (let i = 0; i < 12; i++) await fundedAsk(db, won.p.id, "test");
    const [b] = await db.select().from(s.bid).where(eq(s.bid.id, won.b.id));
    expect(Math.min(...b.tiers.map((t) => t.unitCents))).toBeGreaterThanOrEqual(Math.min(won.b.tiers.at(-1)!.unitCents, sellerFloorCents(b.sellerId, won.prod.retailRefCents)));
    await expect(addTier(db, b.id, { minQty: b.maxCapacity, unitCents: 1 }, "test")).rejects.toThrow();
  });

  it("after lower prices, cutoff still captures no more than any hold", async () => {
    await advance(db, CYCLE, "test"); // COMMIT → FULFIL
    const pays = await db.select().from(s.payment).where(eq(s.payment.status, "CAPTURED"));
    expect(pays.length).toBeGreaterThan(5);
    for (const p of pays) expect(p.capturedCents).toBeLessThanOrEqual(p.authorizedCents);
    expect((await ledgerTotals(db)).balanced).toBe(true);
  });
});
