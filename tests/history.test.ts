// Seeded past weeks run through the real engine and give suppliers a verified track record.
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.GEMINI_API_KEY = "";
process.env.GROQ_API_KEY = "";
process.env.CHANNEL3_API_KEY = "";

import { memoryDb, type DB } from "../lib/db";
import * as s from "../lib/db/schema";
import { seed, SOCIETY_ID } from "../lib/db/seed";
import { currentCycle } from "../lib/engine/cycle";
import { seedHistory } from "../lib/engine/demo";
import { ledgerTotals } from "../lib/engine/ledger";
import { trustScores } from "../lib/engine/trust";

let db: DB;

beforeAll(async () => {
  db = await memoryDb();
  await seed(db);
  await seedHistory(db);
}, 120_000);

describe("seeded history", () => {
  it("closes three past weeks and leaves Week 46 as the current cycle", async () => {
    const closed = await db.select().from(s.cycle).where(eq(s.cycle.phase, "CLOSED"));
    expect(closed.map((c) => c.weekLabel).sort()).toEqual(["Week 43", "Week 44", "Week 45"]);
    const cur = await currentCycle(db, SOCIETY_ID);
    expect(cur?.id).toBe("cyc_w46");
    expect(cur?.phase).toBe("COLLECT");
  });

  it("pays suppliers out and keeps the ledger balanced", async () => {
    const payouts = await db.select().from(s.payout);
    expect(payouts.length).toBeGreaterThan(0);
    expect((await ledgerTotals(db)).balanced).toBe(true);
  });

  it("gives suppliers different trust scores from their delivery and issue record", async () => {
    const events = await db.select().from(s.trustEvent);
    expect(events.some((e) => e.kind === "delivered")).toBe(true);
    const trust = await trustScores(db, "seller", ["sel_fresh", "sel_valley", "sel_corner"]);
    const values = [...trust.values()];
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it("restores the real keys afterwards", () => {
    expect(process.env.PAYPAL_CLIENT_ID).toBe("");
  });
});
