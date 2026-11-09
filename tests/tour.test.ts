// The guided demo walks a whole week, one step at a time, using the real engine.
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
import { performTourStep, TOUR_TOTAL, tourStep } from "../lib/engine/tour";
import { ledgerTotals } from "../lib/engine/ledger";

let db: DB;
const CYCLE = "cyc_w46";
const cycle = async () => (await db.select().from(s.cycle).where(eq(s.cycle.id, CYCLE)))[0];

beforeAll(async () => {
  db = await memoryDb();
  await seed(db);
}, 60_000);

describe("guided demo", () => {
  it("goes through every step in order and ends with a closed, balanced week", async () => {
    const seen: number[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const c = await cycle();
      const step = await tourStep(db, c);
      seen.push(step.n);
      if (!step.action) break;
      await performTourStep(db, c, "test");
    }
    // Steps never go backwards; one may repeat (e.g. neighbours join twice). Every step appears.
    expect(seen.every((n, i) => i === 0 || n >= seen[i - 1])).toBe(true);
    expect([...new Set(seen)]).toEqual(Array.from({ length: TOUR_TOTAL }, (_, i) => i + 1));
    expect((await cycle()).phase).toBe("CLOSED");

    const [bk] = await db.select().from(s.basket).where(and(eq(s.basket.cycleId, CYCLE), eq(s.basket.householdId, "hh_31")));
    expect(bk.capturedCents).toBeGreaterThan(0);
    expect(bk.capturedCents).toBeLessThanOrEqual(bk.ceilingCents);
    expect(bk.refundedCents).toBeGreaterThan(0); // the Secretary refunded the missing pack
    expect((await ledgerTotals(db)).balanced).toBe(true);
    const payouts = await db.select().from(s.payout).where(eq(s.payout.cycleId, CYCLE));
    expect(payouts.length).toBeGreaterThan(0);
  }, 60_000);
});
