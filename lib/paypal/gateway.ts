// The one place PoolCart talks to PayPal. Two implementations behind one interface:
//   sandbox: real PayPal REST calls against api-m.sandbox.paypal.com (when PAYPAL_CLIENT_ID/SECRET are set)
//   mock:    an in-process stand-in with the same rules, so the app runs before keys exist.
// Only the settlement engine (lib/engine) calls the money-moving methods. AI code never imports this.
import { randomUUID } from "node:crypto";

export type PayMode = "sandbox" | "mock";
// PAYPAL_MODE=mock forces the in-process mock even when keys are set (e.g. if a key breaks mid-demo).
export const payMode = (): PayMode => (process.env.PAYPAL_MODE !== "mock" && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET ? "sandbox" : "mock");

export class PayPalError extends Error {
  constructor(
    public status: number,
    public issue: string,
    message: string,
    public debugId?: string,
  ) {
    super(`PayPal ${status} ${issue}: ${message}${debugId ? ` (debug_id=${debugId})` : ""}`);
  }
}

export type AuthStatus = "CREATED" | "CAPTURED" | "PARTIALLY_CAPTURED" | "VOIDED" | "DENIED" | "EXPIRED" | "PENDING";

export interface Gateway {
  mode: PayMode;
  /** Create an intent=AUTHORIZE order that the buyer approves in the PayPal popup. */
  createWalletOrder(a: { cents: number; referenceId: string; description: string }): Promise<{ orderId: string }>;
  /** After buyer approval: authorize (place the hold). */
  authorizeOrder(orderId: string): Promise<{ authorizationId: string; status: AuthStatus; payerEmail?: string }>;
  /** Server-side hold with a sandbox test card (simulated neighbours). */
  cardHold(a: { cents: number; referenceId: string; description: string; name?: string }): Promise<{ orderId: string; authorizationId: string; status: AuthStatus }>;
  getAuthorization(authorizationId: string): Promise<{ status: AuthStatus; amountCents: number }>;
  capture(a: { authorizationId: string; cents: number; finalCapture: boolean; invoiceId: string }): Promise<{ captureId: string; status: string; feeCents: number }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  refund(a: { captureId: string; cents: number; note: string; requestId: string }): Promise<{ refundId: string; status: string }>;
  payout(a: { senderBatchId: string; items: { receiver: string; cents: number; senderItemId: string; note: string }[] }): Promise<{ batchId: string; status: string }>;
  getPayoutBatch(batchId: string): Promise<{ status: string }>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<boolean>;
}

const usd = (cents: number) => ({ currency_code: "USD", value: (cents / 100).toFixed(2) });
const toCents = (v: string | undefined) => Math.round(Number(v ?? 0) * 100);

// ---------------------------------------------------------------------------------------------
// Sandbox (real PayPal REST)
// ---------------------------------------------------------------------------------------------
const BASE = "https://api-m.sandbox.paypal.com"; // sandbox only: no live endpoint exists in this codebase

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const creds = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  if (!res.ok) throw new PayPalError(res.status, body.error ?? "AUTH", body.error_description ?? "OAuth failed");
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function call<T = any>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (method === "POST") headers["PayPal-Request-Id"] = requestId ?? randomUUID();
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (res.ok) return json as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue; // same PayPal-Request-Id → safe retry
    }
    throw new PayPalError(res.status, json?.details?.[0]?.issue ?? json?.name ?? "ERROR", json?.message ?? text.slice(0, 200), json?.debug_id);
  }
}

/** Raw sandbox REST access for less-central APIs (Subscriptions). */
export const paypalRest = call;

const sandbox: Gateway = {
  mode: "sandbox",
  async createWalletOrder({ cents, referenceId, description }) {
    const order = await call("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: referenceId, description, amount: usd(cents) }],
      payment_source: { paypal: { experience_context: { brand_name: "PoolCart", shipping_preference: "NO_SHIPPING", user_action: "CONTINUE" } } },
    });
    return { orderId: order.id };
  },
  async authorizeOrder(orderId) {
    const o = await call("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, `authorize-${orderId}`);
    const auth = o.purchase_units[0].payments.authorizations[0];
    return { authorizationId: auth.id, status: auth.status, payerEmail: o.payer?.email_address };
  },
  async cardHold({ cents, referenceId, description, name = "PoolCart Neighbour" }) {
    const order = await call("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [{ reference_id: referenceId, description, amount: usd(cents) }],
      payment_source: {
        card: {
          name,
          number: "4012888888881881", // PayPal-published sandbox test card
          expiry: "2030-12",
          security_code: "123",
          billing_address: { address_line_1: "1 Maple Way", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
        },
      },
    });
    let auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) {
      const o = await call("POST", `/v2/checkout/orders/${order.id}/authorize`, {}, `authorize-${order.id}`);
      auth = o.purchase_units[0].payments.authorizations[0];
    }
    return { orderId: order.id, authorizationId: auth.id, status: auth.status };
  },
  async getAuthorization(id) {
    const a = await call("GET", `/v2/payments/authorizations/${id}`);
    return { status: a.status, amountCents: toCents(a.amount?.value) };
  },
  async capture({ authorizationId, cents, finalCapture, invoiceId }) {
    const c = await call(
      "POST",
      `/v2/payments/authorizations/${authorizationId}/capture`,
      { amount: usd(cents), final_capture: finalCapture, invoice_id: invoiceId, note_to_payer: "PoolCart: you paid the price your building unlocked." },
      `capture-${invoiceId}`,
    );
    return { captureId: c.id, status: c.status, feeCents: toCents(c.seller_receivable_breakdown?.paypal_fee?.value) };
  },
  async voidAuthorization(id) {
    try {
      await call("POST", `/v2/payments/authorizations/${id}/void`, {}, `void-${id}`);
    } catch (e) {
      if (e instanceof PayPalError && e.issue === "AUTHORIZATION_ALREADY_CAPTURED") return; // final capture already released it
      throw e;
    }
  },
  async refund({ captureId, cents, note, requestId }) {
    const r = await call("POST", `/v2/payments/captures/${captureId}/refund`, { amount: usd(cents), note_to_payer: note }, requestId);
    return { refundId: r.id, status: r.status };
  },
  async payout({ senderBatchId, items }) {
    const r = await call("POST", "/v1/payments/payouts", {
      sender_batch_header: { sender_batch_id: senderBatchId, email_subject: "You have a Collective payout", email_message: "Thanks for delivering to Gulmohar Residency." },
      items: items.map((i) => ({ recipient_type: "EMAIL", receiver: i.receiver, amount: { currency: "USD", value: (i.cents / 100).toFixed(2) }, sender_item_id: i.senderItemId, note: i.note })),
    });
    return { batchId: r.batch_header.payout_batch_id, status: r.batch_header.batch_status };
  },
  async getPayoutBatch(batchId) {
    const r = await call("GET", `/v1/payments/payouts/${batchId}`);
    return { status: r.batch_header.batch_status };
  },
  async verifyWebhook(headers, rawBody) {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return false;
    const r = await call("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    });
    return r.verification_status === "SUCCESS";
  },
};

// ---------------------------------------------------------------------------------------------
// Mock (same rules, no network). Enforces: capture ≤ authorized, no capture after final/void,
// refund ≤ captured, payout batch ids unique. A cardholder named CCREJECT-* is declined, like sandbox.
// ---------------------------------------------------------------------------------------------
type MockAuth = { id: string; amount: number; captured: number; status: AuthStatus };
type MockState = { orders: Map<string, { cents: number; approved: boolean }>; auths: Map<string, MockAuth>; captures: Map<string, { cents: number; refunded: number }>; batches: Set<string> };
const gm = globalThis as unknown as { __poolcartMockPayPal?: MockState };
const st = (gm.__poolcartMockPayPal ??= { orders: new Map(), auths: new Map(), captures: new Map(), batches: new Set() });
const mid = (p: string) => `MOCK-${p}-${randomUUID().slice(0, 8).toUpperCase()}`;
const fee = (cents: number) => Math.round(cents * 0.0349) + 49;

const mock: Gateway = {
  mode: "mock",
  async createWalletOrder({ cents }) {
    const orderId = mid("ORDER");
    st.orders.set(orderId, { cents, approved: false });
    return { orderId };
  },
  async authorizeOrder(orderId) {
    const o = st.orders.get(orderId);
    if (!o) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "order not found");
    const id = mid("AUTH");
    st.auths.set(id, { id, amount: o.cents, captured: 0, status: "CREATED" });
    return { authorizationId: id, status: "CREATED", payerEmail: "buyer@mock.paypal" };
  },
  async cardHold({ cents, name }) {
    if (name?.startsWith("CCREJECT")) throw new PayPalError(422, "INSTRUMENT_DECLINED", "card declined (mock)");
    const { orderId } = await mock.createWalletOrder({ cents, referenceId: "", description: "" });
    const a = await mock.authorizeOrder(orderId);
    return { orderId, authorizationId: a.authorizationId, status: a.status };
  },
  async getAuthorization(id) {
    const a = st.auths.get(id);
    if (!a) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "authorization not found");
    return { status: a.status, amountCents: a.amount };
  },
  async capture({ authorizationId, cents, finalCapture }) {
    const a = st.auths.get(authorizationId);
    if (!a) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "authorization not found");
    if (a.status === "VOIDED" || a.status === "CAPTURED") throw new PayPalError(422, "AUTHORIZATION_ALREADY_CAPTURED", `authorization is ${a.status}`);
    if (a.captured + cents > a.amount) throw new PayPalError(422, "MAX_CAPTURE_AMOUNT_EXCEEDED", "capture exceeds authorized amount");
    a.captured += cents;
    a.status = finalCapture ? "CAPTURED" : "PARTIALLY_CAPTURED";
    const captureId = mid("CAPTURE");
    st.captures.set(captureId, { cents, refunded: 0 });
    return { captureId, status: "COMPLETED", feeCents: fee(cents) };
  },
  async voidAuthorization(id) {
    const a = st.auths.get(id);
    if (!a) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "authorization not found");
    if (a.status === "CAPTURED") return;
    a.status = "VOIDED";
  },
  async refund({ captureId, cents }) {
    const c = st.captures.get(captureId);
    if (!c) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "capture not found");
    if (c.refunded + cents > c.cents) throw new PayPalError(422, "REFUND_AMOUNT_EXCEEDED", "refund exceeds captured amount");
    c.refunded += cents;
    return { refundId: mid("REFUND"), status: "COMPLETED" };
  },
  async payout({ senderBatchId }) {
    if (st.batches.has(senderBatchId)) throw new PayPalError(400, "SENDER_BATCH_ID_ALREADY_USED", "duplicate sender_batch_id");
    st.batches.add(senderBatchId);
    return { batchId: mid("BATCH"), status: "SUCCESS" };
  },
  async getPayoutBatch() {
    return { status: "SUCCESS" };
  },
  async verifyWebhook() {
    return false;
  },
};

/** Mock mode only: rebuild orders, holds and captures from stored payments after a server restart,
 *  so a week in progress still settles. Real PayPal keeps this state itself. */
export function mockRestore(payments: { paypalOrderId: string | null; paypalAuthorizationId: string | null; paypalCaptureId: string | null; authorizedCents: number; capturedCents: number; refundedCents: number; status: string }[]) {
  if (st.orders.size || st.auths.size) return; // process still running: memory is current
  for (const p of payments) {
    if (p.status === "CREATED" && p.paypalOrderId) st.orders.set(p.paypalOrderId, { cents: p.authorizedCents, approved: false });
    if (!p.paypalAuthorizationId) continue;
    const status: AuthStatus = p.status === "CAPTURED" ? "CAPTURED" : p.status === "VOIDED" ? "VOIDED" : "CREATED";
    st.auths.set(p.paypalAuthorizationId, { id: p.paypalAuthorizationId, amount: p.authorizedCents, captured: p.capturedCents, status });
    if (p.paypalCaptureId) st.captures.set(p.paypalCaptureId, { cents: p.capturedCents, refunded: p.refundedCents });
  }
}

export const gateway = (): Gateway => (payMode() === "sandbox" ? sandbox : mock);
