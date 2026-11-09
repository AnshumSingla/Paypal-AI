"use client";
// Supplier plan upgrade billed with PayPal Subscriptions. The server verifies the subscription with
// PayPal before granting the plan (never trusts the browser callback alone).
import { useState, useTransition } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { activatePlanAction } from "@/app/actions";
import { Spinner, Toast } from "@/app/_components/ActionButton";
import { Panel } from "@/app/_components/ui";

const PLANS = [
  { id: "starter", name: "Starter", price: "Free", commission: "8%", perks: "Bid on open pools" },
  { id: "pro", name: "Pro", price: "$19/mo", commission: "4%", perks: "AI price suggestions, analytics, early look at demand" },
  { id: "partner", name: "Partner", price: "$49/mo", commission: "2.5%", perks: "Everything in Pro, priority in ties, several societies" },
] as const;

export function PlanCard({ current, mode, clientId, planIds }: { current: string; mode: "sandbox" | "mock"; clientId?: string; planIds: Record<"pro" | "partner", string> | null }) {
  const [choice, setChoice] = useState<"pro" | "partner" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Panel id="plan" title="Your plan" description="Billed monthly with PayPal Subscriptions." flush>
      <ul className="divide-y divide-line">
        {PLANS.map((p) => (
          <li key={p.id} className={`flex items-start gap-4 px-6 py-4 ${current === p.id ? "bg-brand-soft" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-sm text-muted">{p.price}</span>
                {current === p.id ? <span className="chip bg-brand text-on-brand">Current</span> : null}
              </div>
              <p className="mt-0.5 text-sm text-muted">{p.perks}.</p>
              {current !== p.id && p.id !== "starter" ? (
                <button type="button" className="btn btn-ghost mt-2 !py-1 text-sm" aria-pressed={choice === p.id} onClick={() => setChoice(p.id)}>
                  Upgrade to {p.name}
                </button>
              ) : null}
            </div>
            <div className="text-right">
              <div className="num text-xl font-semibold">{p.commission}</div>
              <div className="text-xs text-muted">commission</div>
            </div>
          </li>
        ))}
      </ul>
      {choice && (
        <div className="border-t border-line px-6 py-4">
          <div className="max-w-sm">
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
        </div>
      )}
      {msg ? (
        <div className="border-t border-line px-6 py-3">
          <Toast ok={msg.ok} text={msg.text} />
        </div>
      ) : null}
    </Panel>
  );
}
