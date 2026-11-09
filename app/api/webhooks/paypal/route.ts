// PayPal webhooks: verify the signature over the raw body, de-duplicate by event id, record.
// The engine already updates state synchronously from API responses; webhooks confirm and catch
// out-of-band changes (e.g. a payout item failing later, a subscription cancelled in PayPal).
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { gateway, payMode } from "@/lib/paypal/gateway";
import { log } from "@/lib/engine/ledger";

export async function POST(request: Request) {
  const raw = await request.text();
  if (payMode() !== "sandbox") return new Response("PayPal not configured", { status: 400 });
  const ok = await gateway().verifyWebhook(request.headers, raw).catch(() => false);
  if (!ok) return new Response("invalid signature", { status: 400 });
  const event = JSON.parse(raw) as { id: string; event_type: string; resource?: any };
  const db = await getDb();
  const inserted = await db.insert(s.webhookEvent).values({ paypalEventId: event.id, type: event.event_type, payload: event }).onConflictDoNothing().returning();
  if (!inserted.length) return new Response("duplicate", { status: 200 });

  // Process after responding quickly; PayPal retries if we take more than 30s.
  queueMicrotask(async () => {
    try {
      const r = event.resource ?? {};
      switch (event.event_type) {
        case "PAYMENT.PAYOUTS-ITEM.FAILED":
        case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": {
          const senderItemId = r.payout_item?.sender_item_id;
          if (senderItemId) await db.update(s.payout).set({ status: "FAILED" }).where(eq(s.payout.senderItemId, senderItemId));
          await log(db, null, "PayPal webhook", "money", `Payout item ${senderItemId ?? "?"} ${event.event_type.split(".").at(-1)!.toLowerCase()}.`);
          break;
        }
        case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": {
          const senderItemId = r.payout_item?.sender_item_id;
          if (senderItemId) await db.update(s.payout).set({ status: "SUCCESS" }).where(eq(s.payout.senderItemId, senderItemId));
          break;
        }
        case "BILLING.SUBSCRIPTION.CANCELLED":
        case "BILLING.SUBSCRIPTION.SUSPENDED":
        case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
          await db.update(s.seller).set({ subscriptionStatus: event.event_type.split(".").at(-1) }).where(eq(s.seller.paypalSubscriptionId, r.id ?? r.billing_agreement_id ?? "-"));
          await log(db, null, "PayPal webhook", "seller", `Subscription ${r.id ?? ""}: ${event.event_type}. The supplier moves to the free plan after a 7-day grace period.`);
          break;
        }
        default:
          break; // captures/refunds/authorizations are already recorded from the API responses
      }
      await db.update(s.webhookEvent).set({ processedAt: new Date() }).where(eq(s.webhookEvent.paypalEventId, event.id));
    } catch (e) {
      console.error("[webhook] processing failed", e);
    }
  });
  return new Response("ok", { status: 200 });
}
