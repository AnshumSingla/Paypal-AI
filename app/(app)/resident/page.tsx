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
import { Empty, Panel, Stat, StatRow } from "@/app/_components/ui";
import { ListPlus, PiggyBank, ShieldCheck, ShoppingBasket, TrendingDown, Wallet } from "lucide-react";

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

  const settled = !!basket && ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(basket.basket.status);
  const retailKept = (basket?.lines ?? []).reduce((t, x) => (x.l.finalUnitCents ? t + x.l.qty * x.prod.retailRefCents - x.l.refundedCents * (x.prod.retailRefCents / x.l.finalUnitCents) : t), 0);
  const paid = settled ? basket!.basket.capturedCents - basket!.basket.refundedCents : 0;
  const listCount = cycle.phase === "COLLECT" || cycle.phase === "BID" ? needs.length : (basket?.lines.length ?? 0);

  return (
    <div>
      <CycleBar cycle={cycle} societyName={`${society.name}, flat ${household.unitLabel}`} />
      {cycle.phase === "COMMIT" && held && <AutoRefresh />}

      <StatRow>
        <Stat icon={<ShoppingBasket size={20} />} title="My list" value={listCount} sentence={listCount === 1 ? "product" : "products"} />
        <Stat
          icon={<Wallet size={20} />}
          tone="brand"
          title="PayPal hold"
          value={held || settled ? fmt(basket!.basket.ceilingCents) : "None"}
          sentence={held ? "approved, not charged yet" : settled ? "was the most you could pay" : "you approve once, at Confirm"}
        />
        <Stat icon={<TrendingDown size={20} />} tone="accent" title={settled ? "You paid" : "If cutoff were now"} value={settled ? fmt(paid) : basket?.lines.length ? fmt(estimate) : "Not yet"} sentence={settled ? (basket!.basket.refundedCents ? `after a ${fmt(basket!.basket.refundedCents)} refund` : "the price the building reached") : "falls as neighbours join"} />
        <Stat icon={<PiggyBank size={20} />} tone="success" title="Saved against retail" value={settled && retailKept > 0 ? fmt(Math.round(retailKept - paid)) : "After cutoff"} sentence={settled && retailKept > 0 ? `${Math.round(((retailKept - paid) / retailKept) * 100)}% less` : undefined} />
      </StatRow>

      {cycle.phase === "COLLECT" && (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div id="list" className="h-fit scroll-mt-24">
            <BasketAssistant cycleId={cycle.id} />
          </div>
          <Panel title="My needs this week" description="Not a commitment. You confirm with exact prices on Wednesday." aside={<span className="chip bg-surface-2 text-muted">{needs.length}</span>} flush>
            {needs.length === 0 ? (
              <Empty icon={<ListPlus size={20} />} title="Nothing yet">
                Type your list or photograph it, and the items appear here.
              </Empty>
            ) : (
              <ul className="divide-y divide-line">
                {needs.map(({ n, prod }) => (
                  <li key={n.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <span className="min-w-0">
                      <span className="num font-semibold">{n.qty}×</span> {prod?.title ?? n.rawText} <span className="text-muted">{prod?.packSize}</span>
                      {n.source === "photo" && <span className="chip ml-2 bg-info-soft text-info">from photo</span>}
                    </span>
                    <ActionButton action={removeNeedAction.bind(null, n.id)} className="text-sm font-medium text-muted hover:text-danger">
                      Remove
                    </ActionButton>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {cycle.phase === "BID" && (
        <Panel id="pools" title="Suppliers are bidding" description="They see totals only, never who ordered what. Prices are set by Wednesday evening.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pools.map((p) => {
              const mine = needs.some((n) => n.n.productId === p.product.id);
              return (
                <div key={p.id} className={`rounded-xl border p-4 ${mine ? "border-brand bg-brand-soft/40" : "border-line"}`}>
                  <div className="font-semibold">{p.product.title}</div>
                  <div className="mt-0.5 text-sm text-muted">
                    {p.product.packSize}. {p.demand} packs wanted, {p.bids} bid{p.bids === 1 ? "" : "s"}.
                  </div>
                  {mine && <span className="chip mt-2 bg-brand-soft text-brand-dark">On your list</span>}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {cycle.phase === "COMMIT" && (
        <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
          <Panel id="pools" title="This week's pools" description="The more neighbours join, the lower the price for everyone in the pool." flush>
            <ul className="divide-y divide-line">
              {pools
                .filter((p) => p.status === "PRICED")
                .map((p) => {
                  const mine = lineByPool.get(p.id);
                  return (
                    <li key={p.id} className={`px-6 py-5 ${mine ? "bg-brand-soft/30" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold">
                            {p.product.title} <span className="font-normal text-muted">{p.product.packSize}</span>
                          </div>
                          <div className="mt-0.5 text-sm text-muted">
                            {p.winning?.sellerName}, now <span className="num font-semibold text-ink">{fmt(p.currentUnit ?? p.ceilingUnit)}</span> a pack.{" "}
                            {p.next ? (
                              <span className="text-brand">
                                {p.next.needed} more and it drops to {fmt(p.next.unitCents)}.
                              </span>
                            ) : (
                              <span className="text-success">Best price unlocked.</span>
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
          </Panel>

          <div className="xl:sticky xl:top-20 xl:h-fit">
            <Panel id="basket" title="My basket" description={held ? "Your hold is in place." : "One PayPal hold covers all of it."}>
              {!basket?.lines.length ? (
                <Empty icon={<ShoppingBasket size={20} />} title="Your basket is empty">
                  Add items from the pools with the + buttons.
                </Empty>
              ) : (
                <div className="space-y-4">
                  <ul className="divide-y divide-line">
                    {basket.lines.map(({ l, prod }) => (
                      <li key={l.id} className="flex justify-between gap-3 py-2">
                        <span>
                          {l.qty}× {prod.title}
                        </span>
                        <span className="num text-muted">up to {fmt(l.qty * l.ceilingUnitCents)}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="num space-y-1.5 rounded-xl bg-surface-2 p-4">
                    <div className="flex justify-between">
                      <dt>PayPal hold, the most you pay</dt>
                      <dd className="font-semibold">{fmt(ceiling)}</dd>
                    </div>
                    <div className="flex justify-between text-brand">
                      <dt>If cutoff were now</dt>
                      <dd className="font-semibold">{fmt(estimate)}</dd>
                    </div>
                  </dl>
                  {held ? (
                    <div className="space-y-2">
                      <p className="flex items-start gap-2 rounded-xl bg-brand-soft p-3 text-brand-dark">
                        <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden />
                        <span>
                          Hold of <span className="num font-semibold">{fmt(basket.basket.ceilingCents)}</span> placed. You&apos;re charged the final price at cutoff.
                        </span>
                      </p>
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
                          <p className="mt-1 text-sm text-muted">No sandbox login? This places the same real sandbox hold with PayPal&apos;s published test card.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {["FULFIL", "RESOLVE", "CLOSED"].includes(cycle.phase) && (
        <Panel id="receipt" title="Your order" description={settled ? "What you approved, what PayPal charged, and what came back." : undefined}>
          {!basket || !basket.lines.length || !["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "RELEASED", "PAYMENT_FAILED"].includes(basket.basket.status) ? (
            <Empty icon={<ShoppingBasket size={20} />} title="No basket this week">
              You didn&apos;t confirm a basket, so nothing was charged.
            </Empty>
          ) : (
            <Settled basket={basket} phase={cycle.phase} dropPoint={society.dropPoint} window={pools.find((p) => p.winning)?.winning?.deliveryWindow ?? "Saturday morning"} />
          )}
        </Panel>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.4fr]">
        <SecretaryPanel db={db} cycleId={cycle.id} role="resident" />
        <WeekTimeline schedule={weekSchedule(cycle, society.dropPoint)} />
      </div>
    </div>
  );
}

function Settled({ basket, phase, dropPoint, window }: { basket: NonNullable<Awaited<ReturnType<typeof basketView>>>; phase: string; dropPoint: string; window: string }) {
  return (
    <div className="space-y-6">
      <Receipt basket={basket} />
      <p>
        Pick up from <b className="font-medium">{dropPoint}</b>, {window}.
      </p>
      <ul className="divide-y divide-line">
        {basket.lines.map(({ l, prod }) => {
          const issue = basket.issues.find((i) => i.basketLineId === l.id);
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <b className="font-medium">{l.qty} ×</b> {prod.title} <span className="text-muted">{prod.packSize}</span>
                <div className="text-sm text-muted">
                  {l.status === "released" ? "Pool missed its minimum: not charged." : `Paid ${fmt(l.finalUnitCents)} a pack. Held at ${fmt(l.ceilingUnitCents)}, retail ${fmt(prod.retailRefCents)}.`}
                  {l.refundedCents ? <span className="text-brand-dark"> Refunded {fmt(l.refundedCents)}.</span> : null}
                </div>
                {issue && (
                  <div className="mt-1 text-sm">
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

