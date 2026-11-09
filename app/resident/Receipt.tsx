// After cutoff: what the resident approved, what PayPal charged, what came back, with the PayPal IDs
// for each step so anyone can check them in the sandbox account.
import type { basketView } from "@/lib/queries";
import { fmt } from "@/lib/util/money";
import { verifyPaymentAction } from "@/app/actions";
import { ActionButton } from "@/app/_components/ActionButton";

type B = NonNullable<Awaited<ReturnType<typeof basketView>>>;

export function Receipt({ basket }: { basket: B }) {
  const held = basket.basket.ceilingCents;
  const charged = basket.basket.capturedCents;
  const refunded = basket.basket.refundedCents;
  // Savings count only what you kept: a refunded pack is neither paid for nor "saved".
  const kept = basket.lines.filter((x) => x.l.finalUnitCents).map((x) => ({ x, share: 1 - x.l.refundedCents / (x.l.qty * x.l.finalUnitCents!) }));
  const retail = Math.round(kept.reduce((s, { x, share }) => s + x.l.qty * x.prod.retailRefCents * share, 0));
  const pay = basket.payments.find((p) => ["CAPTURED", "VOIDED", "AUTHORIZED"].includes(p.status));
  const chargedShare = held ? Math.round((charged / held) * 100) : 0;
  const steps: { what: string; amount: string; id: string | null }[] = pay
    ? [
        { what: "You approved a hold for the maximum", amount: fmt(held), id: pay.paypalAuthorizationId },
        pay.paypalCaptureId ? { what: "PayPal charged the price the building unlocked", amount: fmt(charged), id: pay.paypalCaptureId } : { what: "Nothing was charged; the hold was released", amount: fmt(0), id: null },
        { what: "The rest of the hold went back to you", amount: fmt(held - charged), id: null },
        ...basket.refunds.map((r) => ({ what: `Refund: ${r.reason.replace("_", " ")} item`, amount: fmt(r.amountCents), id: r.paypalRefundId })),
      ]
    : [];
  return (
    <section aria-labelledby="receipt-title">
      <h2 id="receipt-title" className="text-lg font-semibold">
        Your receipt
      </h2>
      <div className="num mt-4 flex flex-wrap items-end gap-x-10 gap-y-3">
        <div>
          <div className="label">Approved</div>
          <div className="text-2xl text-muted line-through decoration-1">{fmt(held)}</div>
        </div>
        <div>
          <div className="label">You paid</div>
          <div className="text-4xl font-semibold text-brand">{fmt(charged - refunded)}</div>
        </div>
        {retail >= 1 && (
          <div>
            <div className="label">Saved against retail</div>
            <div className="text-2xl">
              {fmt(retail - charged + refunded)} <span className="text-base text-muted">({Math.round(((retail - charged + refunded) / retail) * 100)}%)</span>
            </div>
          </div>
        )}
      </div>
      {/* One bar: the charged part of the hold, the rest released. */}
      <div className="mt-4 h-2 w-full max-w-xl overflow-hidden rounded-full bg-[#efeff0]" role="img" aria-label={`Charged ${chargedShare}% of the hold`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${chargedShare}%` }} />
      </div>
      {steps.length > 0 && (
        <ol className="num mt-6 max-w-2xl divide-y divide-line border-y border-line text-sm">
          {steps.map((st) => (
            <li key={st.what + st.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5">
              <span>{st.what}</span>
              <span className="flex items-baseline gap-3">
                {st.id && <span className="text-xs text-muted">PayPal {st.id}</span>}
                <span className="font-medium">{st.amount}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {pay && (
        <div className="mt-3">
          <ActionButton action={verifyPaymentAction.bind(null, pay.id)} className="btn btn-ghost !py-1.5 text-sm">
            Check this with PayPal
          </ActionButton>
        </div>
      )}
      {pay?.mode === "mock" && <p className="mt-2 text-xs text-muted">Running without PayPal keys, so these IDs come from the built-in stand-in, not the sandbox.</p>}
    </section>
  );
}
