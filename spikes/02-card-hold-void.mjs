// Spike ②: a failed pool / withdrawn basket releases the hold with a void.
import "./lib/env.mjs";
import { pp, cardHold } from "./lib/paypal.mjs";
import { spike } from "./lib/report.mjs";

await spike("02", "Card hold → void (pool failed / resident withdrew)", async () => {
  const hold = await cardHold(2000, { referenceId: "basket-void-spike" });
  await pp("POST", `/v2/payments/authorizations/${hold.authorizationId}/void`, {});
  const after = await pp("GET", `/v2/payments/authorizations/${hold.authorizationId}`);
  if (after.status !== "VOIDED") throw new Error(`Expected VOIDED, got ${after.status}`);
  return `authorization ${hold.authorizationId}: ${hold.status} → ${after.status}`;
});
