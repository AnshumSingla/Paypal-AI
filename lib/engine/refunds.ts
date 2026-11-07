// Issues and refunds (Policies §8). AI assesses; code enforces window, caps and auto-approve limits.
import { and, eq, gte, sql } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";
import { fmt } from "../util/money";
import { gateway } from "../paypal/gateway";
import { assessIssue } from "../ai/agents/issue";
import { AUTO_REFUND_LIMIT_CENTS, PolicyError } from "./pricing";
import { log, post } from "./ledger";

const ISSUE_WINDOW_MS = 24 * 3600 * 1000;

async function lineContext(db: DB, basketLineId: string) {
  const [r] = await db
    .select({ l: s.basketLine, bk: s.basket, c: s.cycle, p: s.pool, prod: s.product, bid: s.bid })
    .from(s.basketLine)
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .innerJoin(s.cycle, eq(s.basket.cycleId, s.cycle.id))
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .where(eq(s.basketLine.id, basketLineId));
  if (!r) throw new PolicyError("Item not found.");
  return r;
}

export async function reportIssue(db: DB, a: { basketLineId: string; householdId: string; type: "missing" | "damaged" | "wrong_item" | "quality"; qty: number; description: string; photoDataUrl?: string | null; actor: string }) {
  const ctx = await lineContext(db, a.basketLineId);
  if (ctx.bk.householdId !== a.householdId) throw new PolicyError("You can only report issues on your own order.");
  if (!["won", "refunded_partial"].includes(ctx.l.status)) throw new PolicyError("Only delivered items can have issues.");
  if (!["RESOLVE"].includes(ctx.c.phase) || !ctx.c.handoverAt) throw new PolicyError("Issues can be reported after the captain confirms handover, during the 24h window.");
  if (Date.now() - ctx.c.handoverAt.getTime() > ISSUE_WINDOW_MS) throw new PolicyError("The 24h issue window has closed (Policies §8.1).");
  if (["damaged", "wrong_item", "quality"].includes(a.type) && !a.photoDataUrl) throw new PolicyError("Please add a photo for damaged, wrong or quality issues.");

  const assessment = await assessIssue(db, {
    issueRef: `line:${a.basketLineId}`,
    productTitle: ctx.prod.title,
    packSize: ctx.prod.packSize,
    lineQty: ctx.l.qty,
    unitCents: ctx.l.finalUnitCents!,
    reportedType: a.type,
    reportedQty: a.qty,
    description: a.description,
    photoDataUrl: a.photoDataUrl,
  });
  const remaining = ctx.l.qty * ctx.l.finalUnitCents! - ctx.l.refundedCents;
  const proposed = Math.min(assessment.proposedRefundCents, remaining); // never more than captured for the line
  const issueId = newId("iss");
  await db.insert(s.issue).values({
    id: issueId,
    basketLineId: a.basketLineId,
    type: a.type,
    qtyAffected: assessment.affectedQty,
    description: a.description,
    photoDataUrl: a.photoDataUrl ?? null,
    aiAssessment: { classification: assessment.classification, proposedRefundCents: proposed, confidence: assessment.confidence, rationale: assessment.rationale, source: assessment.source },
  });
  await log(db, ctx.c.id, a.actor, "issue", `Issue reported on ${ctx.prod.title}: ${a.type.replace("_", " ")}. ${assessment.source === "ai" ? "AI" : "Rules"} proposes ${fmt(proposed)}.`);

  // Auto-approve small, plausible claims for households without many recent auto-approvals (Policies §8.3).
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.issue)
    .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .where(and(eq(s.basket.householdId, a.householdId), eq(s.issue.decision, "auto_approved"), gte(s.issue.createdAt, new Date(Date.now() - 30 * 24 * 3600 * 1000))));
  const plausible = assessment.classification !== "not_an_issue" && assessment.confidence !== "low";
  if (proposed > 0 && proposed <= AUTO_REFUND_LIMIT_CENTS && recent[0].n < 3 && plausible) {
    await executeRefund(db, issueId, proposed, "auto_approved", "policy (auto ≤ $10)");
    return { issueId, decision: "auto_approved" as const, refundCents: proposed, assessment };
  }
  return { issueId, decision: "pending" as const, refundCents: proposed, assessment };
}

export async function decideIssue(db: DB, issueId: string, approve: boolean, actor: string, amountCents?: number) {
  const [iss] = await db.select().from(s.issue).where(eq(s.issue.id, issueId));
  if (!iss || iss.decision !== "pending") throw new PolicyError("This issue was already decided.");
  if (!approve) {
    await db.update(s.issue).set({ decision: "rejected", decidedBy: actor, refundCents: 0 }).where(eq(s.issue.id, issueId));
    const ctx = await lineContext(db, iss.basketLineId);
    await log(db, ctx.c.id, actor, "issue", `Issue on ${ctx.prod.title} rejected.`);
    return;
  }
  await executeRefund(db, issueId, amountCents ?? iss.aiAssessment?.proposedRefundCents ?? 0, "approved", actor);
}

async function executeRefund(db: DB, issueId: string, cents: number, decision: "auto_approved" | "approved", actor: string) {
  const [iss] = await db.select().from(s.issue).where(eq(s.issue.id, issueId));
  const ctx = await lineContext(db, iss.basketLineId);
  const remaining = ctx.l.qty * ctx.l.finalUnitCents! - ctx.l.refundedCents;
  if (cents <= 0 || cents > remaining) throw new PolicyError(`Refund must be between $0.01 and ${fmt(remaining)} for this item.`);
  const [pay] = await db.select().from(s.payment).where(and(eq(s.payment.basketId, ctx.bk.id), eq(s.payment.status, "CAPTURED")));
  const r = await gateway().refund({ captureId: pay.paypalCaptureId!, cents, note: `PoolCart refund: ${ctx.prod.title} (${iss.type.replace("_", " ")})`, requestId: `refund-${issueId}` });
  await db.insert(s.refund).values({ id: newId("ref"), issueId, paymentId: pay.id, paypalRefundId: r.refundId, amountCents: cents, reason: iss.type, chargedTo: "seller", sellerId: ctx.bid.sellerId });
  const lineRefunded = ctx.l.refundedCents + cents;
  await db.update(s.basketLine).set({ refundedCents: lineRefunded, status: lineRefunded >= ctx.l.qty * ctx.l.finalUnitCents! ? "refunded_full" : "refunded_partial" }).where(eq(s.basketLine.id, ctx.l.id));
  const bkRefunded = ctx.bk.refundedCents + cents;
  await db.update(s.basket).set({ refundedCents: bkRefunded, status: bkRefunded >= ctx.bk.capturedCents ? "REFUNDED" : "PARTIALLY_REFUNDED" }).where(eq(s.basket.id, ctx.bk.id));
  await db.update(s.issue).set({ decision, decidedBy: actor, refundCents: cents }).where(eq(s.issue.id, issueId));
  await post(db, { cycleId: ctx.c.id, memo: `Refund ${issueId}`, refType: "refund", refId: issueId, legs: [{ account: "seller_payable", debit: cents, sellerId: ctx.bid.sellerId }, { account: "paypal_clearing", credit: cents }] });
  // Refund after the seller was already paid → carried as a negative balance (Policies §8.5).
  if (ctx.c.phase === "CLOSED") await db.update(s.seller).set({ balanceCents: sql`${s.seller.balanceCents} - ${cents}` }).where(eq(s.seller.id, ctx.bid.sellerId));
  await log(db, ctx.c.id, actor, "money", `PayPal refund ${fmt(cents)} for ${ctx.prod.title} (${decision === "auto_approved" ? "auto-approved by policy" : `approved by ${actor}`}); charged to the seller's payout.`);
}
