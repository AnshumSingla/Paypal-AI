"use server";
// Every mutation in the app. Each checks the persona's role, calls the engine and refreshes pages.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getSession, homeFor, SESSION_COOKIE } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { newId } from "@/lib/util/ids";
import { PolicyError } from "@/lib/engine/pricing";
import { PayPalError } from "@/lib/paypal/gateway";
import { advance, rankPool, selectWinner, submitBid } from "@/lib/engine/cycle";
import { completeCheckout, getOrCreateBasket, markReceived, setLineQty, startCheckout, withdrawBasket } from "@/lib/engine/basket";
import { decideIssue, reportIssue } from "@/lib/engine/refunds";
import { retryPayout } from "@/lib/engine/payouts";
import { demoMode, resetDemo, simulateCompetingBids, simulateNeighbours, startNextCycle } from "@/lib/engine/demo";
import { parseBasket, type BasketLineDraft } from "@/lib/ai/agents/basket";
import { suggestTiers } from "@/lib/ai/agents/sellerSide";
import { log } from "@/lib/engine/ledger";
import { activateSubscription } from "@/lib/paypal/subscriptions";
import { runSecretary } from "@/lib/ai/secretary";

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

async function guard<T>(fn: () => Promise<{ message?: string; data?: T } | void>): Promise<ActionResult<T>> {
  try {
    const r = (await fn()) ?? {};
    revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof PolicyError || e instanceof PayPalError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

async function require(roles: string[]) {
  const sess = await getSession();
  if (!sess.user || !roles.includes(sess.user.role)) throw new PolicyError("Switch to a persona with access to this action.");
  return sess;
}

// ---------------------------------------------------------------- personas & demo
export async function switchPersona(userId: string) {
  const sess = await getSession();
  const [u] = await sess.db.select().from(s.appUser).where(eq(s.appUser.id, userId));
  if (!u) return;
  (await cookies()).set(SESSION_COOKIE, u.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(homeFor(u.role));
}

export async function advancePhase(cycleId: string) {
  return guard(async () => {
    // In demo mode anyone can drive the clock from the demo bar; otherwise captains/operators only.
    const sess = demoMode() ? await getSession() : await require(["captain", "operator"]);
    return { message: await advance(sess.db, cycleId, sess.user?.name ?? "demo clock") };
  });
}

export async function simulateNeighboursAction(cycleId: string, count: number) {
  return guard(async () => {
    if (!demoMode()) throw new PolicyError("Demo tools are off.");
    const { db } = await getSession();
    const r = await simulateNeighbours(db, cycleId, count);
    return { message: `${r.joined} neighbours confirmed with PayPal holds${r.failed ? `, ${r.failed} failed` : ""}.` };
  });
}

export async function simulateBidsAction(cycleId: string) {
  return guard(async () => {
    if (!demoMode()) throw new PolicyError("Demo tools are off.");
    const { db } = await getSession();
    return { message: `${await simulateCompetingBids(db, cycleId)} competing bids placed by other sellers.` };
  });
}

export async function resetDemoAction() {
  return guard(async () => {
    if (!demoMode()) throw new PolicyError("Demo tools are off.");
    const { db } = await getSession();
    await resetDemo(db);
    return { message: "Demo reset to Week 46." };
  });
}

export async function nextCycleAction() {
  return guard(async () => {
    const { db, user } = await require(["captain", "operator"]);
    await startNextCycle(db, user.name);
    return { message: "Next week's cycle is open." };
  });
}

// ---------------------------------------------------------------- resident
export async function parseListAction(input: { text?: string; imageDataUrl?: string }) {
  return guard<Awaited<ReturnType<typeof parseBasket>>>(async () => {
    const { db, household } = await require(["resident", "captain"]);
    if (!household) throw new PolicyError("No household for this persona.");
    if (!input.text?.trim() && !input.imageDataUrl) throw new PolicyError("Type your list or add a photo.");
    if (input.imageDataUrl && input.imageDataUrl.length > 7_000_000) throw new PolicyError("Photo is too large; please use one under 5 MB.");
    const data = await parseBasket(db, { ...input, householdId: household.id });
    if (data.photoNeedsAi) throw new PolicyError("Reading photos needs the Claude API key; type the list instead for now.");
    return { data };
  });
}

export async function saveNeedsAction(cycleId: string, lines: BasketLineDraft[], source: "text" | "photo") {
  return guard(async () => {
    const { db, household, user } = await require(["resident", "captain"]);
    const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, cycleId));
    if (c.phase !== "COLLECT") throw new PolicyError("Needs are collected Mon–Tue; during Confirm & pay, add items from the open pools.");
    const usable = lines.filter((l) => l.productId && !l.restricted);
    if (usable.length) {
      await db.insert(s.need).values(usable.map((l) => ({ id: newId("need"), cycleId, householdId: household!.id, rawText: l.raw, productId: l.productId, qty: l.quantity, brandFlexible: l.brandFlexible, source, clarification: l.clarification })));
    }
    const blocked = lines.filter((l) => l.restricted).length;
    await log(db, cycleId, user.name, "resident", `Added ${usable.length} item(s) to this week's needs${blocked ? `; ${blocked} restricted item(s) were not added` : ""}.`);
    return { message: `${usable.length} item(s) added${blocked ? `; ${blocked} item(s) that can't be sold here were skipped` : ""}.` };
  });
}

export async function removeNeedAction(needId: string) {
  return guard(async () => {
    const { db, household } = await require(["resident", "captain"]);
    await db.update(s.need).set({ status: "removed" }).where(and(eq(s.need.id, needId), eq(s.need.householdId, household!.id)));
  });
}

export async function setLineAction(cycleId: string, poolId: string, qty: number) {
  return guard(async () => {
    const { db, household, user } = await require(["resident", "captain"]);
    await setLineQty(db, { cycleId, householdId: household!.id, poolId, qty, actor: user.name });
  });
}

export async function beginCheckoutAction(cycleId: string) {
  return guard<{ orderId: string; cents: number }>(async () => {
    const { db, household, user } = await require(["resident", "captain"]);
    const bk = await getOrCreateBasket(db, cycleId, household!.id);
    return { data: await startCheckout(db, bk.id, user.name) };
  });
}

export async function finishCheckoutAction(cycleId: string, orderId: string) {
  return guard(async () => {
    const { db, household, user } = await require(["resident", "captain"]);
    const bk = await getOrCreateBasket(db, cycleId, household!.id);
    await completeCheckout(db, bk.id, orderId, user.name);
    return { message: "Hold placed. You'll be charged the final group price at cutoff." };
  });
}

export async function withdrawAction(cycleId: string) {
  return guard(async () => {
    const { db, household, user } = await require(["resident", "captain"]);
    const bk = await getOrCreateBasket(db, cycleId, household!.id);
    await withdrawBasket(db, bk.id, user.name);
    return { message: "Withdrawn. Your PayPal hold was voided." };
  });
}

export async function markReceivedAction(basketId: string) {
  return guard(async () => {
    const { db } = await require(["resident", "captain"]);
    await markReceived(db, basketId);
  });
}

export async function reportIssueAction(input: { basketLineId: string; type: "missing" | "damaged" | "wrong_item" | "quality"; qty: number; description: string; photoDataUrl?: string | null }) {
  return guard(async () => {
    const { db, household, user } = await require(["resident", "captain"]);
    const r = await reportIssue(db, { ...input, householdId: household!.id, actor: user.name });
    return { message: r.decision === "auto_approved" ? `The Society Secretary refunded $${(r.refundCents / 100).toFixed(2)} to your PayPal.` : `Reported. The Secretary passed it to the captain: ${r.secretary}` };
  });
}

// ---------------------------------------------------------------- captain
export async function pickWinnerAction(poolId: string, bidId: string) {
  return guard(async () => {
    const { db, user } = await require(["captain", "operator"]);
    await selectWinner(db, poolId, bidId, user.name);
    return { message: "Winner selected." };
  });
}

export async function rerankAction(poolId: string) {
  return guard(async () => {
    const { db } = await require(["captain", "operator"]);
    await rankPool(db, poolId);
  });
}

export async function decideIssueAction(issueId: string, approve: boolean, amountCents?: number) {
  return guard(async () => {
    const { db, user } = await require(["captain", "operator"]);
    await decideIssue(db, issueId, approve, user.name, amountCents);
    return { message: approve ? "Refund sent via PayPal." : "Issue rejected." };
  });
}

// ---------------------------------------------------------------- Society Secretary
/** Ask the Secretary a question. Its tools are scoped to the asker's role. */
export async function askSecretaryAction(cycleId: string, question: string) {
  return guard<{ reply: string; source: "ai" | "rules" }>(async () => {
    const { db, user, household, seller } = await require(["resident", "captain", "seller", "operator"]);
    if (!question.trim()) throw new PolicyError("Type a question first.");
    if (question.length > 1000) throw new PolicyError("Please keep questions under 1,000 characters.");
    const role = user.role === "operator" ? "captain" : user.role;
    const r = await runSecretary(db, { cycleId, role, householdId: household?.id, sellerId: seller?.id, task: { kind: "ask", question } });
    return { data: { reply: r.reply, source: r.source } };
  });
}

/** Captain: let the Secretary put the authorized money on the table and ask suppliers for deeper tiers. */
export async function fundedAsksAction(cycleId: string) {
  return guard(async () => {
    const { db } = demoMode() ? await getSession() : await require(["captain", "operator"]);
    const r = await runSecretary(db, { cycleId, role: "system", task: { kind: "funded_asks" } });
    return { message: r.reply };
  });
}

// ---------------------------------------------------------------- seller
export async function suggestTiersAction(poolId: string, unitCostCents?: number, note?: string) {
  return guard<Awaited<ReturnType<typeof suggestTiers>>>(async () => {
    const { db } = await require(["seller"]);
    const [p] = await db.select({ p: s.pool, prod: s.product }).from(s.pool).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(eq(s.pool.id, poolId));
    return { data: await suggestTiers(db, { poolId, productTitle: p.prod.title, packSize: p.prod.packSize, demand: p.p.demandEstimate, retailRefCents: p.prod.retailRefCents, unitCostCents, sellerNote: note }) };
  });
}

export async function submitBidAction(input: { poolId: string; moq: number; maxCapacity: number; tiers: s.Tier[]; deliveryWindow: string; note?: string }) {
  return guard(async () => {
    const { db, seller } = await require(["seller"]);
    await submitBid(db, { ...input, sellerId: seller!.id });
    return { message: "Bid submitted. The Bid Analyst has ranked it for the captain." };
  });
}

export async function withdrawBidAction(bidId: string) {
  return guard(async () => {
    const { db, seller } = await require(["seller"]);
    await db.update(s.bid).set({ status: "withdrawn" }).where(and(eq(s.bid.id, bidId), eq(s.bid.sellerId, seller!.id), eq(s.bid.status, "submitted")));
  });
}

export async function activatePlanAction(plan: "pro" | "partner", subscriptionId?: string) {
  return guard(async () => {
    const { db, seller, user } = await require(["seller"]);
    const msg = await activateSubscription(db, seller!.id, plan, subscriptionId, user.name);
    return { message: msg };
  });
}

export async function retryPayoutAction(payoutId: string) {
  return guard(async () => {
    const { db, user } = await require(["seller", "operator"]);
    await retryPayout(db, payoutId, user.name);
  });
}

// ---------------------------------------------------------------- operator
export async function setSellerStatusAction(sellerId: string, status: "approved" | "suspended") {
  return guard(async () => {
    const { db, user } = await require(["operator"]);
    await db.update(s.seller).set({ status }).where(eq(s.seller.id, sellerId));
    await log(db, null, user.name, "seller", `Supplier ${sellerId} ${status}.`);
  });
}
