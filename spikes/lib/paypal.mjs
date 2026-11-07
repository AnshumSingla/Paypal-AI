import { randomUUID } from "node:crypto";
import { requireEnv } from "./env.mjs";

const BASE = "https://api-m.sandbox.paypal.com"; // sandbox only, by design

let cached = null;

async function token() {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = requireEnv("PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OAuth failed ${res.status}: ${JSON.stringify(body)}`);
  cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, scope: body.scope };
  return cached.value;
}

export async function scopes() {
  await token();
  return cached.scope ?? "";
}

export class PayPalError extends Error {
  constructor(status, body) {
    const issue = body?.details?.[0]?.issue ?? body?.name ?? "UNKNOWN";
    super(`PayPal ${status} ${issue}: ${body?.message ?? ""} (debug_id=${body?.debug_id ?? "n/a"})`);
    this.status = status;
    this.body = body;
    this.issue = issue;
  }
}

/** Call the PayPal REST API. POSTs always carry a PayPal-Request-Id for idempotency. */
export async function pp(method, path, body, { requestId } = {}) {
  const headers = {
    Authorization: `Bearer ${await token()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (method === "POST") headers["PayPal-Request-Id"] = requestId ?? randomUUID();
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new PayPalError(res.status, json);
  return json;
}

export const usd = (cents) => ({ currency_code: "USD", value: (cents / 100).toFixed(2) });

/** PayPal-published sandbox test card (developer.paypal.com/tools/sandbox/card-testing). */
export function testCard(name = "PoolCart Tester") {
  return {
    card: {
      name,
      number: "4012888888881881",
      expiry: "2030-12",
      security_code: "123",
      billing_address: { address_line_1: "1 Maple Way", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
    },
  };
}

/**
 * Create an AUTHORIZE order paid by sandbox card, then authorize it.
 * Returns { orderId, authorizationId, status }.
 */
export async function cardHold(cents, { name, referenceId = "basket-spike" } = {}) {
  const order = await pp("POST", "/v2/checkout/orders", {
    intent: "AUTHORIZE",
    purchase_units: [{ reference_id: referenceId, amount: usd(cents), description: "PoolCart weekly basket (spike)" }],
    payment_source: testCard(name),
  });
  let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) {
    // Some account configurations return APPROVED/CREATED and need an explicit authorize call.
    const authorized = await pp("POST", `/v2/checkout/orders/${order.id}/authorize`, {});
    auth = authorized.purchase_units?.[0]?.payments?.authorizations?.[0];
  }
  if (!auth) throw new Error(`No authorization returned for order ${order.id} (status ${order.status})`);
  return { orderId: order.id, authorizationId: auth.id, status: auth.status, orderStatus: order.status, raw: auth };
}
