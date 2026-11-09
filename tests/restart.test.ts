// In mock mode a server restart mid-week must not lose the residents' holds.
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.CHANNEL3_API_KEY = "";

import { memoryDb, restoreMockPayPal, type DB } from "../lib/db";
import * as s from "../lib/db/schema";
import { seed } from "../lib/db/seed";
import { advance } from "../lib/engine/cycle";
import { simulateCompetingBids, simulateNeighbours } from "../lib/engine/demo";

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

describe("mock PayPal after a restart", () => {
  it("rebuilds holds from the database so cutoff still captures", async () => {
    // Simulate a process restart: the in-memory mock forgets everything.
    const mem = (globalThis as unknown as { __poolcartMockPayPal: { orders: Map<unknown, unknown>; auths: Map<unknown, unknown>; captures: Map<unknown, unknown> } }).__poolcartMockPayPal;
    mem.orders.clear();
    mem.auths.clear();
    mem.captures.clear();

    await restoreMockPayPal(db);
    await advance(db, CYCLE, "test"); // COMMIT → FULFIL

    const failed = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, CYCLE), eq(s.basket.status, "PAYMENT_FAILED")));
    const captured = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, CYCLE), eq(s.basket.status, "CAPTURED")));
    expect(failed.length).toBe(0);
    expect(captured.length).toBeGreaterThan(5);
  });
});
