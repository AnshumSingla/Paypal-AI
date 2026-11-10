// Walks one whole demo week (the guided tour, reviewer's choices included) against the real PayPal
// sandbox and prints every PayPal id it created, so they can be matched in the sandbox dashboard.
// Usage: npx tsx scripts/sandbox-week.ts   (needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { memoryDb } = await import("../lib/db");
  const s = await import("../lib/db/schema");
  const { seed } = await import("../lib/db/seed");
  const { performTourStep, tourStep } = await import("../lib/engine/tour");
  const { ledgerTotals } = await import("../lib/engine/ledger");
  const { payMode } = await import("../lib/paypal/gateway");

  if (payMode() !== "sandbox") throw new Error("PayPal keys are not set, so this would only exercise the stand-in.");
  const db = await memoryDb();
  await seed(db);
  const CYCLE = "cyc_w46";
  // The branches a reviewer is most likely to try: a declined card, a big claim the captain approves.
  const choices: Record<string, string> = { issue: "large", decide: "approve" };
  for (let guard = 0; guard < 25; guard++) {
    const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, CYCLE));
    const step = await tourStep(db, c);
    console.log(`step ${String(step.n).padStart(2)}  ${step.title}`);
    if (!step.action) break;
    const t = Date.now();
    await performTourStep(db, c, "sandbox-week", choices[step.id]);
    console.log(`         done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }

  const [c] = await db.select().from(s.cycle).where(eq(s.cycle.id, CYCLE));
  const payments = await db.select().from(s.payment);
  const refunds = await db.select().from(s.refund);
  const payouts = await db.select().from(s.payout).where(eq(s.payout.cycleId, CYCLE));
  const usd = (n: number) => `$${(n / 100).toFixed(2)}`;
  const { like } = await import("drizzle-orm");
  for (const a of await db.select().from(s.activity).where(like(s.activity.message, "%simulated neighbours%"))) console.log(a.message);
  for (const a of await db.select().from(s.activity).where(like(s.activity.message, "Cutoff settled%"))) console.log(a.message);
  console.log(`\nphase ${c.phase}; ledger balanced: ${(await ledgerTotals(db)).balanced}`);
  console.log(`payments: ${payments.length} (${payments.filter((p) => p.mode === "sandbox").length} on sandbox)`);
  for (const p of payments.slice(0, 6)) console.log(`  order ${p.paypalOrderId}  auth ${p.paypalAuthorizationId ?? "-"}  capture ${p.paypalCaptureId ?? "-"}`);
  for (const r of refunds) console.log(`refund ${r.paypalRefundId} ${usd(r.amountCents)}`);
  for (const p of payouts) console.log(`payout ${p.status} batch ${p.paypalBatchId ?? "-"} net ${usd(p.netCents)}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
