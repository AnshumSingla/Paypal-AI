import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/session";
import { basketView, needsView, poolsView, societyContext } from "@/lib/queries";
import { payMode } from "@/lib/paypal/gateway";
import { fmt } from "@/lib/util/money";
import { removeNeedAction, withdrawAction, markReceivedAction, testCardHoldAction } from "@/app/actions";
import { CycleBar } from "@/app/_components/CycleBar";
import { WeekTimeline } from "@/app/_components/WeekTimeline";
import { weekSchedule } from "@/lib/schedule";
import { ActionButton } from "@/app/_components/ActionButton";
import { TierBar } from "@/app/_components/TierBar";
import { BasketAssistant } from "./BasketAssistant";
import { Checkout } from "./Checkout";
import { QtyStepper } from "./QtyStepper";
import { IssueForm } from "./IssueForm";
import { Receipt } from "./Receipt";
import { AutoRefresh } from "@/app/_components/AutoRefresh";
import { SecretaryPanel } from "@/app/_components/SecretaryPanel";

export const metadata: Metadata = { title: "My week" };

export default async function ResidentPage() {
  const { db, user, household } = await getSession();
  if (!user || !household) redirect("/");
  const { society, cycle } = await societyContext(db);
  if (!cycle) return <p>No cycle yet.</p>;
  const [pools, basket, needs] = await Promise.all([poolsView(db, cycle.id), basketView(db, cycle.id, household.id), needsView(db, cycle.id, household.id)]);
  const lineByPool = new Map((basket?.lines ?? []).map((x) => [x.p.id, x]));
  const held = basket?.basket.status === "AUTHORIZED";
  const ceiling = (basket?.lines ?? []).reduce((s, x) => s + x.l.qty * x.l.ceilingUnitCents, 0);
  const estimate = (basket?.lines ?? []).reduce((s, x) => {
    const pv = pools.find((p) => p.id === x.p.id);
    return s + x.l.qty * (pv?.currentUnit ?? x.l.ceilingUnitCents);
  }, 0);

  return (
    <div>
      <CycleBar cycle={cycle} societyName={`${society.name}, flat ${household.unitLabel}`} />
      {cycle.phase === "COMMIT" && held && <AutoRefresh />}

      {cycle.phase === "COLLECT" && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <BasketAssistant cycleId={cycle.id} />
          <div className="card p-5">
            <h2 className="text-lg font-semibold">My needs this week</h2>
            <p className="text-sm text-muted">Not a commitment. You&apos;ll see exact prices and confirm on Wednesday.</p>
            <ul className="mt-3 divide-y divide-line">
              {needs.length === 0 && <li className="py-6 text-center text-sm text-muted">Nothing yet. Add your list on the left.</li>}
              {needs.map(({ n, prod }) => (
                <li key={n.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <b>{n.qty}×</b> {prod?.title ?? n.rawText} <span className="text-muted">{prod?.packSize}</span>
                    {n.source === "photo" && <span className="chip ml-1 bg-info-soft text-info">from photo</span>}
                  </span>
                  <ActionButton action={removeNeedAction.bind(null, n.id)} className="text-xs text-muted hover:text-danger">
                    Remove
                  </ActionButton>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {cycle.phase === "BID" && (
        <div className="card p-5">
          <h2 className="text-lg font-semibold">Local suppliers are bidding on your building&apos;s order</h2>
          <p className="text-sm text-muted">Suppliers see totals only, never who ordered what. Prices are set by Wednesday evening.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pools.map((p) => (
              <div key={p.id} className="rounded-xl border border-line p-3">
                <div className="font-semibold">{p.product.title}</div>
                <div className="text-xs text-muted">
                  {p.product.packSize}. {p.demand} packs wanted, {p.bids} bid{p.bids === 1 ? "" : "s"} so far.
                </div>
                {needs.some((n) => n.n.productId === p.product.id) && <span className="chip mt-2 bg-brand-soft text-brand-dark">On your list</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {cycle.phase === "COMMIT" && (
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="card p-5">
            <h2 className="text-lg font-semibold">This week&apos;s pools</h2>
            <p className="text-sm text-muted">The more neighbours join a pool, the lower the price for everyone in it. Your hold covers the top price; you pay the final one.</p>
            <ul className="mt-4 space-y-4">
              {pools
                .filter((p) => p.status === "PRICED")
                .map((p) => {
                  const mine = lineByPool.get(p.id);
                  return (
                    <li key={p.id} className={`rounded-xl border p-4 ${mine ? "border-brand bg-brand-soft/40" : "border-line"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">
                            {p.product.title} <span className="font-normal text-muted">{p.product.packSize}</span>
                          </div>
                          <div className="text-xs text-muted">
                            {p.winning?.sellerName}, now <b className="num font-medium text-ink">{fmt(p.currentUnit ?? p.ceilingUnit)}</b> a pack.{" "}
                            {p.next ? (
                              <span className="text-brand-dark">
                                {p.next.needed} more and it drops to {fmt(p.next.unitCents)}.
                              </span>
                            ) : (
                              <span className="text-brand-dark">Best price unlocked.</span>
                            )}
                          </div>
                        </div>
                        <QtyStepper cycleId={cycle.id} poolId={p.id} qty={mine?.l.qty ?? 0} max={society.maxQtyPerLine} held={held} />
                      </div>
                      <div className="mt-3">
                        <TierBar tiers={p.winning!.tiers} committed={p.committed} pending={p.pending} retail={p.product.retailRefCents} />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>

          <aside className="card h-fit space-y-4 p-5 lg:sticky lg:top-20">
            <h2 className="text-lg font-semibold">My basket</h2>
            {!basket?.lines.length ? (
              <p className="text-sm text-muted">Add items from the pools to get started.</p>
            ) : (
              <>
                <ul className="divide-y divide-line text-sm">
                  {basket.lines.map(({ l, prod }) => (
                    <li key={l.id} className="flex justify-between py-1.5">
                      <span>
                        {l.qty}× {prod.title}
                      </span>
                      <span className="num text-muted">up to {fmt(l.qty * l.ceilingUnitCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-xl bg-canvas p-3 text-sm">
                  <div className="flex justify-between">
                    <span>PayPal hold (max)</span>
                    <b>{fmt(ceiling)}</b>
                  </div>
                  <div className="flex justify-between text-brand-dark">
                    <span>If cutoff were now</span>
                    <b>{fmt(estimate)}</b>
                  </div>
                  <p className="mt-2 text-xs text-muted">You&apos;ll never pay more than the hold. Items whose pool misses its minimum aren&apos;t charged at all.</p>
                </div>
                {held ? (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-brand-soft p-3 text-sm text-brand-dark">
                      PayPal hold of <b className="num">{fmt(basket.basket.ceilingCents)}</b> placed. You&apos;re charged the final price at cutoff.
                    </div>
                    <ActionButton action={withdrawAction.bind(null, cycle.id)} className="btn btn-danger w-full" confirm="Withdraw and void your PayPal hold?">
                      Withdraw and release my hold
                    </ActionButton>
                  </div>
                ) : (
                  <>
                    <Checkout cycleId={cycle.id} mode={payMode()} clientId={process.env.PAYPAL_CLIENT_ID} ceilingCents={ceiling} />
                    {payMode() === "sandbox" && (
                      <div className="border-t border-line pt-3">
                        <ActionButton action={testCardHoldAction.bind(null, cycle.id)} className="btn btn-ghost w-full">
                          Hold with a PayPal sandbox test card
                        </ActionButton>
                        <p className="mt-1 text-xs text-muted">No sandbox login? This places the same real sandbox hold with PayPal&apos;s published test card.</p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {["FULFIL", "RESOLVE", "CLOSED"].includes(cycle.phase) && (
        <div className="card p-5">
          {!basket || !basket.lines.length || !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "RELEASED", "PAYMENT_FAILED"].includes(basket.basket.status) ? (
            <p className="text-sm text-muted">You didn&apos;t confirm a basket this week. Nothing was charged.</p>
          ) : (
            <Settled
              basket={basket}
              phase={cycle.phase}
              dropPoint={society.dropPoint}
              window={pools.find((p) => p.winning)?.winning?.deliveryWindow ?? "Saturday morning"}
            />
          )}
        </div>
      )}

      <div className="mt-8 max-w-2xl">
        <SecretaryPanel db={db} cycleId={cycle.id} role="resident" />
      </div>
      <div className="mt-8">
        <WeekTimeline schedule={weekSchedule(cycle, society.dropPoint)} />
      </div>
    </div>
  );
}

function Settled({ basket, phase, dropPoint, window }: { basket: NonNullable<Awaited<ReturnType<typeof basketView>>>; phase: string; dropPoint: string; window: string }) {
  return (
    <div className="space-y-6">
      <Receipt basket={basket} />
      <p className="text-sm">
        Pick up from <b className="font-medium">{dropPoint}</b>, {window}.
      </p>
      <ul className="divide-y divide-line">
        {basket.lines.map(({ l, prod }) => {
          const issue = basket.issues.find((i) => i.basketLineId === l.id);
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <div>
                <b className="font-medium">{l.qty} ×</b> {prod.title} <span className="text-muted">{prod.packSize}</span>
                <div className="text-xs text-muted">
                  {l.status === "released" ? "Pool missed its minimum: not charged." : `Paid ${fmt(l.finalUnitCents)} a pack. Held at ${fmt(l.ceilingUnitCents)}, retail ${fmt(prod.retailRefCents)}.`}
                  {l.refundedCents ? <span className="text-brand-dark"> Refunded {fmt(l.refundedCents)}.</span> : null}
                </div>
                {issue && (
                  <div className="mt-1 text-xs">
                    <span className={`chip ${issue.decision === "pending" ? "bg-accent-soft text-accent-ink" : issue.decision === "rejected" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-dark"}`}>Issue: {issue.decision.replace("_", " ")}</span>{" "}
                    <span className="text-muted">{issue.aiAssessment?.rationale}</span>
                  </div>
                )}
              </div>
              {phase === "RESOLVE" && ["won", "refunded_partial"].includes(l.status) && !issue && <IssueForm basketLineId={l.id} maxQty={l.qty} title={prod.title} />}
            </li>
          );
        })}
      </ul>
      {phase === "RESOLVE" && !basket.basket.receivedAt && (
        <ActionButton action={markReceivedAction.bind(null, basket.basket.id)} className="btn btn-ghost">
          I picked up my order
        </ActionButton>
      )}
    </div>
  );
}

