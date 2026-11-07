// Spike ①: hold the ceiling, capture the lower "unlocked tier" amount, release the rest, then partial refund.
// This is PoolCart's core money mechanic (Architecture §7–8).
import "./lib/env.mjs";
import { pp, usd, cardHold } from "./lib/paypal.mjs";
import { spike } from "./lib/report.mjs";

const CEILING = 4120; // $41.20 held at tier-1 prices
const FINAL = 3460; //   $34.60 after the group unlocked tier 3
const REFUND = 310; //   $3.10 cracked egg tray

await spike("01", "Card hold → partial final capture → partial refund", async () => {
  const hold = await cardHold(CEILING, { referenceId: "basket-B1204-w46" });
  const log = [`order ${hold.orderId} (${hold.orderStatus}), authorization ${hold.authorizationId} = ${hold.status} for $${(CEILING / 100).toFixed(2)}`];

  const capture = await pp("POST", `/v2/payments/authorizations/${hold.authorizationId}/capture`, {
    amount: usd(FINAL),
    final_capture: true,
    invoice_id: `spike-${Date.now()}`,
    note_to_payer: "PoolCart: you paid the price your building unlocked.",
  });
  const fee = capture.seller_receivable_breakdown?.paypal_fee?.value;
  log.push(`capture ${capture.id} = ${capture.status} for $${capture.amount.value} (PayPal fee $${fee ?? "?"})`);

  const authAfter = await pp("GET", `/v2/payments/authorizations/${hold.authorizationId}`);
  log.push(`authorization after final capture: ${authAfter.status}`);
  if (!["CAPTURED", "PARTIALLY_CAPTURED"].includes(authAfter.status)) {
    throw new Error(`Unexpected authorization status ${authAfter.status}\n${log.join("\n")}`);
  }

  // A second capture must be refused because final_capture=true released the remainder.
  try {
    await pp("POST", `/v2/payments/authorizations/${hold.authorizationId}/capture`, { amount: usd(100), final_capture: true });
    log.push("WARNING: second capture after final_capture succeeded (remainder was NOT released)");
  } catch (e) {
    log.push(`second capture correctly refused: ${e.issue ?? e.message}`);
  }

  const refund = await pp("POST", `/v2/payments/captures/${capture.id}/refund`, {
    amount: usd(REFUND),
    note_to_payer: "PoolCart issue refund: cracked egg tray",
  });
  log.push(`refund ${refund.id} = ${refund.status} for $${(REFUND / 100).toFixed(2)}`);

  const captureAfter = await pp("GET", `/v2/payments/captures/${capture.id}`);
  log.push(`capture after refund: ${captureAfter.status}`);
  return log.join("\n");
});
