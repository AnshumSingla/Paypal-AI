// Settlement must survive one bad basket and be safe to run again (mock PayPal, rule-based AI).
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.CHANNEL3_API_KEY = "";

import { memoryDb, type DB } from "../lib/db";
import * as s from "../lib/db/schema";
import { seed } from "../lib/db/seed";
import { advance } from "../lib/engine/cycle";
import { cardCheckout, getOrCreateBasket, setLineQty } from "../lib/engine/basket";
import { simulateCompetingBids, simulateNeighbours } from "../lib/engine/demo";
import { settleCycle } from "../lib/engine/settlement";
import { ledgerTotals } from "../lib/engine/ledger";
import { gateway } from "../lib/paypal/gateway";

let db: DB;
const CYCLE = "cyc_w46";

beforeAll(async () => {
  db = await memoryDb();
  await seed(db);
  await advance(db, CYCLE, "test"); // COLLECT → BID
  await simulateCompetingBids(db, CYCLE);
  await advance(db, CYCLE, "test"); // BID → COMMIT
  await simulateNeighbours(db, CYCLE, 30);
}, 60_000);

afterEach(() => vi.restoreAllMocks());

describe("settlement robustness", () => {
  it("a hold that can't be voided doesn't stop everyone else being settled", async () => {
    // hh_31 orders only from a pool that will miss its MOQ, so its hold must be voided at cutoff.
    const [doomed] = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, CYCLE), eq(s.pool.status, "PRICED")));
    await db.update(s.bid).set({ moq: 9999 }).where(eq(s.bid.id, doomed.winningBidId!));
    await setLineQty(db, { cycleId: CYCLE, householdId: "hh_31", poolId: doomed.id, qty: 1, actor: "test" });
    const bk = await getOrCreateBasket(db, CYCLE, "hh_31");
    await cardCheckout(db, bk.id, "test");

    vi.spyOn(gateway(), "voidAuthorization").mockRejectedValue(new Error("network down"));
    await advance(db, CYCLE, "test"); // COMMIT → FULFIL

    const captured = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, CYCLE), eq(s.basket.status, "CAPTURED")));
    expect(captured.length).toBeGreaterThan(5);
    const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, CYCLE));
    expect(c.phase).toBe("FULFIL");
    expect((await ledgerTotals(db)).balanced).toBe(true);
  });

  it("running settlement again charges nobody twice", async () => {
    const before = await db.select().from(s.payment).where(eq(s.payment.status, "CAPTURED"));
    const captureSpy = vi.spyOn(gateway(), "capture");
    await settleCycle(db, CYCLE, "test");
    expect(captureSpy).not.toHaveBeenCalled();
    const after = await db.select().from(s.payment).where(eq(s.payment.status, "CAPTURED"));
    expect(after.length).toBe(before.length);
    expect((await ledgerTotals(db)).balanced).toBe(true);
  });
});
