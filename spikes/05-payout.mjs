// Spike ⑤: pay a seller with PayPal Payouts, and confirm a retried batch is not paid twice.
import "./lib/env.mjs";
import { requireEnv } from "./lib/env.mjs";
import { pp, scopes } from "./lib/paypal.mjs";
import { spike } from "./lib/report.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await spike("05", "Seller payout (Payouts API) + idempotent retry", async () => {
  const { PAYPAL_SANDBOX_PERSONAL_EMAIL: receiver } = requireEnv("PAYPAL_SANDBOX_PERSONAL_EMAIL");
  const scope = await scopes();
  const hasPayouts = scope.includes("payouts");
  const batchId = `cycle-spike-${Date.now()}`;
  const body = {
    sender_batch_header: {
      sender_batch_id: batchId,
      email_subject: "PoolCart payout",
      email_message: "Your PoolCart payout for Maple Heights, week 46.",
    },
    items: [
      {
        recipient_type: "EMAIL",
        receiver,
        amount: { currency: "USD", value: "1.00" },
        sender_item_id: `${batchId}:seller-freshfarm`,
        note: "Net of 4% commission (spike)",
      },
    ],
  };

  const created = await pp("POST", "/v1/payments/payouts", body);
  const id = created.batch_header.payout_batch_id;
  let status = created.batch_header.batch_status;
  for (let i = 0; i < 10 && ["PENDING", "PROCESSING"].includes(status); i++) {
    await sleep(3000);
    status = (await pp("GET", `/v1/payments/payouts/${id}`)).batch_header.batch_status;
  }

  let retry;
  try {
    await pp("POST", "/v1/payments/payouts", body);
    retry = "WARNING: duplicate sender_batch_id was accepted";
  } catch (e) {
    retry = `duplicate batch correctly refused: ${e.issue}`;
  }
  return `token has payouts scope: ${hasPayouts}\nbatch ${id} status ${status}\n${retry}`;
});
