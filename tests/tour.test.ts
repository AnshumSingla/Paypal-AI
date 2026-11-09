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

  it("lets the reviewer choose: withdraw sends Ananya back to her hold; a big claim goes to the captain", async () => {
    const fresh = await memoryDb();
    await seed(fresh);
    const now = async () => (await fresh.select().from(s.cycle).where(eq(s.cycle.id, CYCLE)))[0];
    const choices: Record<string, string> = { neighbours: "withdraw", issue: "large", decide: "reject" };
    const ids: string[] = [];
    const used = new Set<string>();
    for (let guard = 0; guard < 25; guard++) {
      const c = await now();
      const step = await tourStep(fresh, c);
      ids.push(step.id);
      if (!step.action) break;
      // Each branch is taken once; after that the tour continues on its default path.
      const pick = !used.has(step.id) ? choices[step.id] : undefined;
      if (pick) used.add(step.id);
      await performTourStep(fresh, c, "test", pick);
    }
    // Withdrawing voided her hold, so the hold step came round again.
    expect(ids.filter((x) => x === "hold").length).toBe(2);
    // The claim over $10 reached the captain, who rejected it: no refund for Ananya.
    expect(ids).toContain("decide");
    const [bk] = await fresh.select().from(s.basket).where(and(eq(s.basket.cycleId, CYCLE), eq(s.basket.householdId, "hh_31")));
    expect(bk.refundedCents).toBe(0);
    const [rejected] = await fresh.select().from(s.issue).where(eq(s.issue.decision, "rejected"));
    expect(rejected).toBeTruthy();
    expect((await now()).phase).toBe("CLOSED");
    expect((await ledgerTotals(fresh)).balanced).toBe(true);
  }, 90_000);
});
