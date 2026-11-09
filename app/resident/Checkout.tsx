"use client";
// One PayPal approval per week: intent=AUTHORIZE for the ceiling amount (one hold, sized at the highest price).
// Sandbox mode renders real PayPal Buttons; mock mode (no keys) simulates the approval step.
import { useState, useTransition } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { beginCheckoutAction, finishCheckoutAction } from "@/app/actions";
import { Spinner, Toast } from "@/app/_components/ActionButton";

export function Checkout({ cycleId, mode, clientId, ceilingCents }: { cycleId: string; mode: "sandbox" | "mock"; clientId?: string; ceilingCents: number }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (mode === "sandbox" && clientId) {
    return (
      <div className="space-y-2">
        <PayPalScriptProvider options={{ clientId, intent: "authorize", currency: "USD", components: "buttons" }}>
          <PayPalButtons
            style={{ layout: "vertical", shape: "rect", label: "paypal", height: 44 }}
            fundingSource="paypal"
            createOrder={async () => {
              const r = await beginCheckoutAction(cycleId);
              if (!r.ok) {
                setMsg({ ok: false, text: r.error });
                throw new Error(r.error);
              }
              return r.data!.orderId;
            }}
            onApprove={async (data) => {
              const r = await finishCheckoutAction(cycleId, data.orderID);
              setMsg(r.ok ? { ok: true, text: r.message ?? "Hold placed." } : { ok: false, text: r.error });
            }}
            onCancel={() => setMsg({ ok: false, text: "Cancelled. Nothing was held." })}
            onError={(err) => setMsg({ ok: false, text: `PayPal error: ${String(err)}` })}
          />
        </PayPalScriptProvider>
        {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        className="btn w-full !bg-[#ffc439] !py-3 !text-[#111] hover:!bg-[#f2b92f]"
        disabled={pending || ceilingCents <= 0}
        onClick={() =>
          start(async () => {
            const r = await beginCheckoutAction(cycleId);
            if (!r.ok) return setMsg({ ok: false, text: r.error });
            const f = await finishCheckoutAction(cycleId, r.data!.orderId);
            setMsg(f.ok ? { ok: true, text: f.message ?? "Hold placed." } : { ok: false, text: f.error });
          })
        }
      >
        {pending && <Spinner />} Approve hold with PayPal <span className="chip bg-white/60">stand-in</span>
      </button>
      <p className="text-xs text-muted">Running without PayPal keys, so this stands in for the PayPal approval popup. With sandbox keys you get the real PayPal button.</p>
      {msg ? <Toast ok={msg.ok} text={msg.text} /> : null}
    </div>
  );
}
