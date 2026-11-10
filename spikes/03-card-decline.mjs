// Spike ③: a declined card at hold time (Architecture §8 edge case). Uses PayPal's documented
// sandbox rejection trigger in the cardholder name field.
import "./lib/env.mjs";
import { cardHold } from "./lib/paypal.mjs";
import { spike } from "./lib/report.mjs";

await spike("03", "Card decline is detectable (CCREJECT-REFUSED)", async () => {
  try {
    const hold = await cardHold(1500, { name: "CCREJECT-REFUSED", referenceId: "basket-decline-spike" });
    if (hold.status === "DENIED" || hold.status === "DECLINED") {
      return `authorization returned status ${hold.status} (handled as decline)`;
    }
    throw new Error(`Expected a decline but authorization status was ${hold.status}`);
  } catch (e) {
    // Only a card refusal counts; an account problem (e.g. PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING) is a failure.
    if (e.status === 422 && /DECLINED|REFUSED|INSTRUMENT/.test(String(e.issue))) return `declined with HTTP ${e.status} ${e.issue}`;
    throw e;
  }
});
