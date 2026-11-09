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
import { recordTrust } from "./trust";

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

  // The Society Secretary decides: refund within the limits below, or escalate to the captain.
  const { secretaryDecideIssue } = await import("../ai/secretary"); // dynamic: secretary imports this file
  const outcome = await secretaryDecideIssue(db, ctx.c.id, issueId);
  return { issueId, decision: outcome.refunded ? ("auto_approved" as const) : ("pending" as const), refundCents: outcome.refunded || proposed, assessment, secretary: outcome.reply };
}

/**
 * Pure: may an agent refund this without a human (Policies §8.3)? Returns the reason it may not,
 * or null. At most $10, never more than was charged for the line, one refund per issue, and no more
 * than 3 automatic refunds per household in 30 days.
 */
export function agentRefundProblem(a: { cents: number; remainingCents: number; recentAutoApprovals: number; decision: string }): string | null {
  if (a.decision !== "pending") return "This issue was already decided.";
  if (!Number.isInteger(a.cents) || a.cents <= 0) return "Refund must be a positive amount in cents.";
  if (a.cents > a.remainingCents) return `That's more than the ${fmt(a.remainingCents)} charged for this item.`;
  if (a.cents > AUTO_REFUND_LIMIT_CENTS) return `Automatic refunds stop at ${fmt(AUTO_REFUND_LIMIT_CENTS)}; the captain decides larger ones.`;
  if (a.recentAutoApprovals >= 3) return "This household already had 3 automatic refunds in 30 days; the captain decides.";
  return null;
}

/** What the limits allow for one issue, for the Secretary's tools and playbook. */
export async function issueForAgent(db: DB, issueId: string) {
  const [iss] = await db.select().from(s.issue).where(eq(s.issue.id, issueId));
  if (!iss) throw new PolicyError("Issue not found.");
  const ctx = await lineContext(db, iss.basketLineId);
  const recent = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.issue)
    .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .where(and(eq(s.basket.householdId, ctx.bk.householdId), eq(s.issue.decision, "auto_approved"), gte(s.issue.createdAt, new Date(Date.now() - 30 * 24 * 3600 * 1000))));
  return { iss, ctx, remainingCents: ctx.l.qty * ctx.l.finalUnitCents! - ctx.l.refundedCents, recentAutoApprovals: recent[0].n };
}

/** The only refund path an agent has. Code checks the limits; PayPal moves the money. */
export async function agentRefund(db: DB, issueId: string, cents: number, actor: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { iss, remainingCents, recentAutoApprovals } = await issueForAgent(db, issueId);
  const problem = agentRefundProblem({ cents, remainingCents, recentAutoApprovals, decision: iss.decision });
  if (problem) return { ok: false, reason: problem };
  await executeRefund(db, issueId, cents, "auto_approved", actor);
  return { ok: true };
}

export async function decideIssue(db: DB, issueId: string, approve: boolean, actor: string, amountCents?: number) {
  const [iss] = await db.select().from(s.issue).where(eq(s.issue.id, issueId));
  if (!iss || iss.decision !== "pending") throw new PolicyError("This issue was already decided.");
  if (!approve) {
    await db.update(s.issue).set({ decision: "rejected", decidedBy: actor, refundCents: 0 }).where(eq(s.issue.id, issueId));
    const ctx = await lineContext(db, iss.basketLineId);
    await recordTrust(db, { subjectType: "household", subjectId: ctx.bk.householdId, cycleId: ctx.c.id, kind: "claim_rejected", refId: issueId });
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
  const r = await gateway().refund({ captureId: pay.paypalCaptureId!, cents, note: `Collective refund: ${ctx.prod.title} (${iss.type.replace("_", " ")})`, requestId: `refund-${issueId}` });
  await db.insert(s.refund).values({ id: newId("ref"), issueId, paymentId: pay.id, paypalRefundId: r.refundId, amountCents: cents, reason: iss.type, chargedTo: "seller", sellerId: ctx.bid.sellerId });
  const lineRefunded = ctx.l.refundedCents + cents;
  await db.update(s.basketLine).set({ refundedCents: lineRefunded, status: lineRefunded >= ctx.l.qty * ctx.l.finalUnitCents! ? "refunded_full" : "refunded_partial" }).where(eq(s.basketLine.id, ctx.l.id));
  const bkRefunded = ctx.bk.refundedCents + cents;
  await db.update(s.basket).set({ refundedCents: bkRefunded, status: bkRefunded >= ctx.bk.capturedCents ? "REFUNDED" : "PARTIALLY_REFUNDED" }).where(eq(s.basket.id, ctx.bk.id));
  await db.update(s.issue).set({ decision, decidedBy: actor, refundCents: cents }).where(eq(s.issue.id, issueId));
  await recordTrust(db, { subjectType: "seller", subjectId: ctx.bid.sellerId, cycleId: ctx.c.id, kind: "issue_upheld", refId: issueId, note: iss.type });
  await post(db, { cycleId: ctx.c.id, memo: `Refund ${issueId}`, refType: "refund", refId: issueId, legs: [{ account: "seller_payable", debit: cents, sellerId: ctx.bid.sellerId }, { account: "paypal_clearing", credit: cents }] });
  // Refund after the seller was already paid → carried as a negative balance (Policies §8.5).
  if (ctx.c.phase === "CLOSED") await db.update(s.seller).set({ balanceCents: sql`${s.seller.balanceCents} - ${cents}` }).where(eq(s.seller.id, ctx.bid.sellerId));
  await log(db, ctx.c.id, actor, "money", `PayPal refund ${fmt(cents)} for ${ctx.prod.title} (${decision === "auto_approved" ? "auto-approved by policy" : `approved by ${actor}`}); charged to the seller's payout.`);
}
