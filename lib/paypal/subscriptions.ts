// Seller plans billed with PayPal Subscriptions (Policies §9.2). Plans are created in the sandbox on
// first use (or read from PAYPAL_PLAN_ID_PRO / PAYPAL_PLAN_ID_PARTNER). Access is granted only after
// the server verifies the subscription with PayPal, never from the browser callback alone.
import { eq } from "drizzle-orm";
import type { DB } from "../db";
import * as s from "../db/schema";
import { payMode, paypalRest, PayPalError } from "./gateway";
import { PLAN_PRICES_CENTS } from "../engine/pricing";
import { log, post } from "../engine/ledger";
import { fmt } from "../util/money";

type PaidPlan = "pro" | "partner";
const g = globalThis as unknown as { __poolcartPlans?: Promise<Record<PaidPlan, string>> };

export async function planIds(): Promise<Record<PaidPlan, string> | null> {
  if (payMode() !== "sandbox") return null;
  if (process.env.PAYPAL_PLAN_ID_PRO && process.env.PAYPAL_PLAN_ID_PARTNER) return { pro: process.env.PAYPAL_PLAN_ID_PRO, partner: process.env.PAYPAL_PLAN_ID_PARTNER };
  g.__poolcartPlans ??= (async () => {
    const productRes = await paypalRest("POST", "/v1/catalogs/products", { name: "PoolCart Seller Plans", type: "SERVICE", category: "SOFTWARE" }, "poolcart-seller-plans-product");
    const mk = async (plan: PaidPlan, name: string) => {
      const r = await paypalRest(
        "POST",
        "/v1/billing/plans",
        {
          product_id: productRes.id,
          name,
          status: "ACTIVE",
          billing_cycles: [{ frequency: { interval_unit: "MONTH", interval_count: 1 }, tenure_type: "REGULAR", sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: (PLAN_PRICES_CENTS[plan] / 100).toFixed(2), currency_code: "USD" } } }],
          payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
        },
        `poolcart-plan-${plan}`,
      );
      return r.id as string;
    };
    const ids = { pro: await mk("pro", "PoolCart Pro (4% commission)"), partner: await mk("partner", "PoolCart Partner (2.5% commission)") };
    console.log(`[paypal] created sandbox plans; set PAYPAL_PLAN_ID_PRO=${ids.pro} PAYPAL_PLAN_ID_PARTNER=${ids.partner} to reuse them`);
    return ids;
  })();
  return g.__poolcartPlans;
}

export async function activateSubscription(db: DB, sellerId: string, plan: PaidPlan, subscriptionId: string | undefined, actor: string) {
  let id = subscriptionId ?? `MOCK-SUB-${sellerId}`;
  if (payMode() === "sandbox") {
    if (!subscriptionId) throw new PayPalError(400, "MISSING_SUBSCRIPTION", "No subscription id from PayPal");
    const ids = await planIds();
    const sub = await paypalRest("GET", `/v1/billing/subscriptions/${subscriptionId}`);
    if (!["ACTIVE", "APPROVED"].includes(sub.status) || sub.plan_id !== ids![plan]) throw new PayPalError(400, "SUBSCRIPTION_NOT_ACTIVE", `Subscription is ${sub.status}`);
    id = sub.id;
  }
  await db.update(s.seller).set({ plan, paypalSubscriptionId: id, subscriptionStatus: "ACTIVE" }).where(eq(s.seller.id, sellerId));
  await post(db, { cycleId: null, memo: `Subscription ${plan} ${sellerId}`, refType: "subscription", refId: id, legs: [{ account: "paypal_clearing", debit: PLAN_PRICES_CENTS[plan] }, { account: "platform_revenue", credit: PLAN_PRICES_CENTS[plan] }] });
  await log(db, null, actor, "seller", `Seller upgraded to ${plan} (${fmt(PLAN_PRICES_CENTS[plan])}/month via PayPal Subscriptions). New commission applies to bids won from now on.`);
  return `You're on ${plan === "pro" ? "Pro" : "Partner"}. New winning bids use the lower commission.`;
}
