// The Secretary's refund power is bounded by code, whatever the agent asks for.
import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

process.env.PAYPAL_CLIENT_ID = "";
process.env.PAYPAL_CLIENT_SECRET = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.CHANNEL3_API_KEY = "";

import { memoryDb, type DB } from "../lib/db";
import * as s from "../lib/db/schema";
import { seed } from "../lib/db/seed";
import { advance } from "../lib/engine/cycle";
import { simulateCompetingBids, simulateNeighbours } from "../lib/engine/demo";
import { agentRefund, agentRefundProblem, reportIssue } from "../lib/engine/refunds";
import { runSecretary } from "../lib/ai/secretary";

describe("agent refund limits (pure)", () => {
  const ok = { cents: 500, remainingCents: 800, recentAutoApprovals: 0, decision: "pending" };
  it("allows a small refund within what was charged", () => expect(agentRefundProblem(ok)).toBeNull());
  it("refuses over $10", () => expect(agentRefundProblem({ ...ok, cents: 1001, remainingCents: 5000 })).toMatch(/\$10/));
  it("refuses more than was charged", () => expect(agentRefundProblem({ ...ok, cents: 900 })).toMatch(/charged/));
  it("refuses an issue already decided", () => expect(agentRefundProblem({ ...ok, decision: "auto_approved" })).toMatch(/already/));
  it("refuses a 4th automatic refund in 30 days", () => expect(agentRefundProblem({ ...ok, recentAutoApprovals: 3 })).toMatch(/captain/));
  it("refuses zero or fractional cents", () => {
    expect(agentRefundProblem({ ...ok, cents: 0 })).not.toBeNull();
    expect(agentRefundProblem({ ...ok, cents: 2.5 })).not.toBeNull();
  });
});

describe("Secretary decides issues (rules mode)", () => {
  let db: DB;
  const CYCLE = "cyc_w46";
  beforeAll(async () => {
    db = await memoryDb();
    await seed(db);
    await advance(db, CYCLE, "test");
    await simulateCompetingBids(db, CYCLE);
    await advance(db, CYCLE, "test");
    await simulateNeighbours(db, CYCLE, 30);
    await advance(db, CYCLE, "test"); // settle
    await advance(db, CYCLE, "test"); // handover
  }, 60_000);

  async function wonLine() {
    const rows = await db.select({ l: s.basketLine, bk: s.basket }).from(s.basketLine).innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id)).where(and(eq(s.basket.cycleId, CYCLE), eq(s.basketLine.status, "won")));
    return rows.find((r) => r.l.finalUnitCents! < 1000)!; // one pack under the $10 automatic limit
  }

  it("refunds a small missing item and records only one refund even if asked twice", async () => {
    const { l, bk } = await wonLine();
    const r = await reportIssue(db, { basketLineId: l.id, householdId: bk.householdId, type: "missing", qty: 1, description: "one pack missing", actor: "test" });
    expect(r.decision).toBe("auto_approved");
    const again = await agentRefund(db, r.issueId, 100, "test");
    expect(again.ok).toBe(false);
    const refunds = await db.select().from(s.refund).where(eq(s.refund.issueId, r.issueId));
    expect(refunds.length).toBe(1);
  });

  it("escalates a claim over $10 to the captain instead of refunding", async () => {
    const [big] = await db
      .select({ l: s.basketLine, bk: s.basket })
      .from(s.basketLine)
      .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
      .where(and(eq(s.basket.cycleId, CYCLE), eq(s.basketLine.status, "won")));
    // Make the line expensive enough that the whole claim exceeds the automatic limit.
    await db.update(s.basketLine).set({ qty: 5, finalUnitCents: 900 }).where(eq(s.basketLine.id, big.l.id));
    const r = await reportIssue(db, { basketLineId: big.l.id, householdId: big.bk.householdId, type: "missing", qty: 5, description: "whole order missing", actor: "test" });
    expect(r.decision).toBe("pending");
    const refunds = await db.select().from(s.refund).where(eq(s.refund.issueId, r.issueId));
    expect(refunds.length).toBe(0);
    const escalations = await db.select().from(s.activity).where(and(eq(s.activity.cycleId, CYCLE), eq(s.activity.kind, "issue")));
    expect(escalations.some((a) => a.message.startsWith("Escalated to the captain"))).toBe(true);
  });

  it("answers a question without a key by stating facts, not guesses", async () => {
    const r = await runSecretary(db, { cycleId: CYCLE, role: "resident", householdId: "hh_1", task: { kind: "ask", question: "How much did I save?" } });
    expect(r.source).toBe("rules");
    expect(r.reply).toMatch(/AI answers are off/);
  });
});
