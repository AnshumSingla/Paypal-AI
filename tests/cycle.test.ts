// End-to-end cycle on an in-memory Postgres with the mock PayPal gateway and rule-based AI.
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
import { advance, submitBid } from "../lib/engine/cycle";
import { completeCheckout, setLineQty, startCheckout, withdrawBasket, getOrCreateBasket } from "../lib/engine/basket";
import { resetDemo, simulateCompetingBids, simulateNeighbours } from "../lib/engine/demo";
import { reportIssue } from "../lib/engine/refunds";
import { ledgerTotals } from "../lib/engine/ledger";
import { parseBasket } from "../lib/ai/agents/basket";

let db: DB;
const CYCLE = "cyc_w46";

beforeAll(async () => {
  db = await memoryDb();
  await seed(db);
}, 60_000);

describe("full weekly cycle (mock PayPal, rule-based AI)", () => {
  it("parses a typed list with the rules fallback and blocks restricted items", async () => {
    const r = await parseBasket(db, { text: "2 dozen eggs, any brand\nIndia Gate basmati rice 10lb\n1 gal whole milk x2\nbeer 12pk", householdId: "hh_31" });
    expect(r.source).toBe("rules");
    expect(r.lines.find((l) => /eggs/i.test(l.raw))).toMatchObject({ productId: "prd_eggs12", quantity: 2 });
    expect(r.lines.find((l) => /milk/i.test(l.raw))).toMatchObject({ productId: "prd_milkwhole", quantity: 2 });
    expect(r.lines.find((l) => /beer/i.test(l.raw))?.restricted).toBe(true);
    expect(r.lines.find((l) => /basmati/i.test(l.raw))?.productId).toBe("prd_basmati_ig");
  });

  it("COLLECT → BID builds one pool per product with demand", async () => {
    await advance(db, CYCLE, "test");
    const pools = await db.select().from(s.pool).where(eq(s.pool.cycleId, CYCLE));
    expect(pools.length).toBeGreaterThan(5);
    expect(pools.every((p) => p.status === "OPEN_FOR_BIDS" && p.demandEstimate > 0)).toBe(true);
  });

  it("rejects bids priced at or above retail", async () => {
    const [eggs] = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, CYCLE), eq(s.pool.productId, "prd_eggs12")));
    await expect(submitBid(db, { poolId: eggs.id, sellerId: "sel_fresh", moq: 10, maxCapacity: 80, tiers: [{ minQty: 10, unitCents: 450 }], deliveryWindow: "Sat" })).rejects.toThrow(/retail/);
  });

  it("BID → COMMIT auto-selects winners and prefills baskets", async () => {
    const [eggs] = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, CYCLE), eq(s.pool.productId, "prd_eggs12")));
    await submitBid(db, { poolId: eggs.id, sellerId: "sel_fresh", moq: 15, maxCapacity: 120, tiers: [{ minQty: 15, unitCents: 389 }, { minQty: 30, unitCents: 349 }, { minQty: 45, unitCents: 319 }], deliveryWindow: "Sat 9:00–12:00" });
    await simulateCompetingBids(db, CYCLE);
    await advance(db, CYCLE, "test");
    const priced = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, CYCLE), eq(s.pool.status, "PRICED")));
    expect(priced.length).toBeGreaterThan(3);
    const drafts = await db.select().from(s.basket).where(eq(s.basket.cycleId, CYCLE));
    expect(drafts.length).toBeGreaterThan(10);
  });

  it("resident holds the ceiling, can withdraw (void) and re-confirm", async () => {
    const [eggs] = await db.select().from(s.pool).where(and(eq(s.pool.cycleId, CYCLE), eq(s.pool.productId, "prd_eggs12")));
    await setLineQty(db, { cycleId: CYCLE, householdId: "hh_31", poolId: eggs.id, qty: 2, actor: "test" });
    const bk = await getOrCreateBasket(db, CYCLE, "hh_31");
    const { orderId, cents } = await startCheckout(db, bk.id, "test");
    expect(cents).toBeGreaterThan(0);
    await completeCheckout(db, bk.id, orderId, "test");
    await withdrawBasket(db, bk.id, "test");
    const [voided] = await db.select().from(s.payment).where(and(eq(s.payment.basketId, bk.id), eq(s.payment.status, "VOIDED")));
    expect(voided).toBeTruthy();
    const again = await startCheckout(db, bk.id, "test");
    await completeCheckout(db, bk.id, again.orderId, "test");
    const [b2] = await db.select().from(s.basket).where(eq(s.basket.id, bk.id));
    expect(b2.status).toBe("AUTHORIZED");
  });

  it("COMMIT → FULFIL captures ≤ hold for every basket and keeps the ledger balanced", async () => {
    await simulateNeighbours(db, CYCLE, 30);
    await advance(db, CYCLE, "test");
    const pays = await db.select().from(s.payment).where(eq(s.payment.status, "CAPTURED"));
    expect(pays.length).toBeGreaterThan(5);
    for (const p of pays) expect(p.capturedCents).toBeLessThanOrEqual(p.authorizedCents);
    expect(pays.some((p) => p.capturedCents < p.authorizedCents)).toBe(true); // a tier was unlocked
    expect((await ledgerTotals(db)).balanced).toBe(true);
  });

  it("issue refund is auto-approved under $10 and capped at the line amount", async () => {
    await advance(db, CYCLE, "test"); // FULFIL → RESOLVE (handover)
    const bk = await getOrCreateBasket(db, CYCLE, "hh_31");
    const [line] = await db.select().from(s.basketLine).where(and(eq(s.basketLine.basketId, bk.id), eq(s.basketLine.status, "won")));
    const r = await reportIssue(db, { basketLineId: line.id, householdId: "hh_31", type: "missing", qty: 5, description: "only got one tray", actor: "test" });
    expect(r.decision).toBe("auto_approved");
    expect(r.refundCents).toBeLessThanOrEqual(line.qty * line.finalUnitCents!);
  });

  it("RESOLVE → CLOSED pays sellers net of commission and refunds", async () => {
    await advance(db, CYCLE, "test");
    const payouts = await db.select().from(s.payout).where(eq(s.payout.cycleId, CYCLE));
    expect(payouts.length).toBeGreaterThan(0);
    const fresh = payouts.find((p) => p.sellerId === "sel_fresh")!;
    expect(fresh.netCents).toBe(fresh.grossCents - fresh.commissionCents - fresh.refundsCents);
    expect(fresh.commissionCents).toBe(Math.round(fresh.grossCents * 0.08)); // Starter plan 8%
    const totals = await ledgerTotals(db);
    expect(totals.balanced).toBe(true);
  });

  it("after Reset, a second full week still pays sellers out", async () => {
    await resetDemo(db);
    await advance(db, CYCLE, "test"); // COLLECT → BID
    await simulateCompetingBids(db, CYCLE);
    await advance(db, CYCLE, "test"); // BID → COMMIT
    await simulateNeighbours(db, CYCLE, 30);
    await advance(db, CYCLE, "test"); // COMMIT → FULFIL
    await advance(db, CYCLE, "test"); // FULFIL → RESOLVE
    await advance(db, CYCLE, "test"); // RESOLVE → CLOSED
    const payouts = await db.select().from(s.payout).where(eq(s.payout.cycleId, CYCLE));
    expect(payouts.length).toBeGreaterThan(0);
    expect(payouts.every((p) => p.status === "SUCCESS" || p.status === "CARRIED_FORWARD")).toBe(true);
  }, 60_000); // Reset also replays three past weeks
});
