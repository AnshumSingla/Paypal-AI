// Spike ④ (interactive): the real resident path, a PayPal wallet approval with intent AUTHORIZE.
// You open the printed link, log in with your SANDBOX PERSONAL account and approve; then press Enter here.
import "./lib/env.mjs";
import readline from "node:readline/promises";
import { pp, usd } from "./lib/paypal.mjs";
import { spike } from "./lib/report.mjs";

await spike("04", "PayPal wallet approval → authorize → void", async () => {
  const order = await pp("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [{ reference_id: "basket-wallet-spike", amount: usd(4120), description: "PoolCart weekly basket (spike)" }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "PoolCart",
          user_action: "CONTINUE",
          shipping_preference: "NO_SHIPPING",
          return_url: "https://example.com/poolcart/return",
          cancel_url: "https://example.com/poolcart/cancel",
        },
      },
    },
  });
  const link = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  console.log(`\nOpen this link, log in with your sandbox PERSONAL account, and approve:\n\n  ${link}\n`);
  console.log("After approving you'll land on example.com (that's expected). Then come back here.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("Press Enter once approved... ");
  rl.close();

  const authorized = await pp("POST", `/v2/checkout/orders/${order.id}/authorize`, {});
  const auth = authorized.purchase_units[0].payments.authorizations[0];
  await pp("POST", `/v2/payments/authorizations/${auth.id}/void`, {});
  return `order ${order.id} approved by ${authorized.payer?.email_address ?? "payer"}; authorization ${auth.id} ${auth.status}, then voided`;
});
