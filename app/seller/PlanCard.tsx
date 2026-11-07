"use client";
// Seller plan upgrade billed with PayPal Subscriptions. The server verifies the subscription with
// PayPal before granting the plan (never trusts the browser callback alone).
import { useState, useTransition } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { activatePlanAction } from "@/app/actions";
import { Spinner, Toast } from "@/app/_components/ActionButton";

const PLANS = [
  { id: "starter", name: "Starter", price: "Free", commission: "8%", perks: "Bid on open pools" },
  { id: "pro", name: "Pro", price: "$19/mo", commission: "4%", perks: "AI Pricing Copilot, analytics, early demand access" },
  { id: "partner", name: "Partner", price: "$49/mo", commission: "2.5%", perks: "Pro + tie-break priority, multi-society" },
] as const;

export function PlanCard({ current, mode, clientId, planIds }: { current: string; mode: "sandbox" | "mock"; clientId?: string; planIds: Record<"pro" | "partner", string> | null }) {
  const [choice, setChoice] = useState<"pro" | "partner" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold">Your plan</h2>
        <span className="chip bg-info-soft text-info">PayPal Subscriptions</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className={`rounded-xl border p-3 text-sm ${current === p.id ? "border-brand bg-brand-soft" : "border-line"}`}>
            <div className="flex justify-between">
              <b>{p.name}</b>
              <span>{p.price}</span>
            </div>
            <div className="text-xl font-extrabold">{p.commission}</div>
            <div className="text-xs text-muted">commission · {p.perks}</div>
            {current === p.id ? (
              <span className="chip mt-2 bg-brand text-white">Current</span>
            ) : p.id !== "starter" ? (
              <button className="btn btn-ghost mt-2 !py-1 text-xs" onClick={() => setChoice(p.id)}>
                Upgrade
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {choice && (
        <div className="mt-4 max-w-sm">
          {mode === "sandbox" && clientId && planIds ? (
            <PayPalScriptProvider options={{ clientId, vault: true, intent: "subscription", components: "buttons" }}>
              <PayPalButtons
                style={{ label: "subscribe", height: 40 }}
                createSubscription={(_d, actions) => actions.subscription.create({ plan_id: planIds[choice] })}
                onApprove={async (data) => {
                  const r = await activatePlanAction(choice, data.subscriptionID ?? undefined);
                  setMsg(r.ok ? { ok: true, text: r.message ?? "Upgraded." } : { ok: false, text: r.error });
                  setChoice(null);
                }}
              />
            </PayPalScriptProvider>
          ) : (
            <button
              className="btn w-full !bg-[#ffc439] !text-[#111]"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await activatePlanAction(choice);
                  setMsg(r.ok ? { ok: true, text: r.message ?? "Upgraded." } : { ok: false, text: r.error });
                  setChoice(null);
                })
              }
            >
              {pending && <Spinner />} Subscribe with PayPal <span className="chip bg-white/60">mock</span>
            </button>
          )}
        </div>
      )}
      {msg ? (
        <div className="mt-2">
          <Toast ok={msg.ok} text={msg.text} />
        </div>
      ) : null}
    </div>
  );
}
