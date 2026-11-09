import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { poolsView, societyContext } from "@/lib/queries";
import { payMode } from "@/lib/paypal/gateway";
import { planIds } from "@/lib/paypal/subscriptions";
import { COMMISSION_BPS } from "@/lib/engine/pricing";
import { fmt } from "@/lib/util/money";
import { refreshPayoutsAction, retryPayoutAction, withdrawBidAction } from "@/app/actions";
import { CycleBar } from "@/app/_components/CycleBar";
import { ActionButton } from "@/app/_components/ActionButton";
import { Kpi } from "@/app/_components/Bits";
import { TierBar } from "@/app/_components/TierBar";
import { BidBuilder } from "./BidBuilder";
import { PlanCard } from "./PlanCard";
import { SecretaryPanel } from "@/app/_components/SecretaryPanel";

export const metadata: Metadata = { title: "Supplier portal" };

const POOL_STATUS: Record<string, string> = { PRICED: "Taking orders", SUCCEEDED: "Ordered", DELIVERED: "Delivered", FAILED: "Missed minimum", SELLER_DEFAULTED: "Not delivered" };
const PAYOUT_STATUS: Record<string, string> = { SUCCESS: "Paid", SENT: "Sent", PENDING: "Pending", FAILED: "Failed", CARRIED_FORWARD: "Carried forward" };

export default async function SellerPage() {
  const { db, user, seller } = await getSession();
  if (!user || !seller) redirect("/");
  const { society, cycle } = await societyContext(db);
  if (!cycle) return <p>No cycle yet.</p>;
  const pools = await poolsView(db, cycle.id);
  const myBids = await db.select().from(s.bid).where(and(eq(s.bid.sellerId, seller.id), inArray(s.bid.poolId, pools.map((p) => p.id).concat("-")), inArray(s.bid.status, ["submitted", "won", "lost"])));
  const bidByPool = new Map(myBids.map((b) => [b.poolId, b]));
  const payouts = await db.select({ po: s.payout, c: s.cycle }).from(s.payout).innerJoin(s.cycle, eq(s.payout.cycleId, s.cycle.id)).where(eq(s.payout.sellerId, seller.id)).orderBy(desc(s.payout.createdAt));
  const won = pools.filter((p) => p.winning?.sellerId === seller.id);
  let ids: Record<"pro" | "partner", string> | null = null;
  try {
    ids = await planIds();
  } catch (e) {
    console.error("[subscriptions] could not prepare plans", e);
  }

  return (
    <div>
      <CycleBar cycle={cycle} societyName={`${seller.businessName}, supplying ${society.name}`} />
      {seller.status !== "approved" && <div className="card mb-6 border-accent bg-accent-soft p-4 text-sm">Your supplier account is {seller.status}. An operator approves new suppliers before they can bid.</div>}
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Open pools" value={String(pools.filter((p) => p.status === "OPEN_FOR_BIDS").length)} sub="Totals only, no personal data" />
        <Kpi label="Pools won" value={String(won.length)} sub={cycle.weekLabel} />
        <Kpi label="Commission" value={`${COMMISSION_BPS[seller.plan] / 100}%`} sub={`${seller.plan} plan`} />
        <Kpi label="Paid out (all time)" value={fmt(payouts.filter((p) => ["SUCCESS", "SENT"].includes(p.po.status)).reduce((a, p) => a + p.po.netCents, 0))} sub={seller.balanceCents < 0 ? `balance ${fmt(seller.balanceCents)}` : "via PayPal Payouts"} accent />
      </div>

      {cycle.phase === "BID" && (
        <section className="card mb-6 p-5">
          <h2 className="text-lg font-semibold">Pooled demand open for bids</h2>
          <p className="mb-4 text-sm text-muted">Prices are landed at {society.dropPoint}. One bulk drop instead of about 30 doorstep deliveries.</p>
          <ul className="space-y-4">
            {pools
              .filter((p) => p.status === "OPEN_FOR_BIDS")
              .map((p) => {
                const mine = bidByPool.get(p.id);
                return (
                  <li key={p.id} className="rounded-xl border border-line p-4">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <b className="font-medium">{p.product.title}</b> <span className="text-muted">{p.product.packSize}</span>
                        <div className="text-xs text-muted">
                          {p.demand} packs wanted. Retail {fmt(p.product.retailRefCents)}. {p.bids} bid{p.bids === 1 ? "" : "s"}.
                        </div>
                        {p.aiNotes && <div className="text-xs text-muted">{p.aiNotes}</div>}
                      </div>
                      {mine && (
                        <div className="text-right text-xs">
                          <span className="chip bg-brand-soft text-brand-dark">Your bid scores {mine.aiScore ?? "—"}</span>
                          {(mine.aiFlags ?? []).map((f) => (
                            <div key={f} className="text-danger">
                              {f}
                            </div>
                          ))}
                          {mine.status === "submitted" && (
                            <ActionButton action={withdrawBidAction.bind(null, mine.id)} className="mt-1 text-xs text-muted underline">
                              Withdraw
                            </ActionButton>
                          )}
                        </div>
                      )}
                    </div>
                    <BidBuilder poolId={p.id} demand={p.demand} retailCents={p.product.retailRefCents} title={p.product.title} existing={mine && mine.status === "submitted" ? mine : undefined} />
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {won.length > 0 && (
        <section className="card mb-6 p-5">
          <h2 className="text-lg font-semibold">Your pools this week</h2>
          <ul className="mt-3 grid gap-4 md:grid-cols-2">
            {won.map((p) => (
              <li key={p.id} className="rounded-xl border border-line p-4">
                <div className="flex justify-between">
                  <b>{p.product.title}</b>
                  <span className="chip bg-canvas">{POOL_STATUS[p.status] ?? p.status}</span>
                </div>
                <div className="mb-3 text-xs text-muted">
                  {p.committed} packs {p.finalUnit ? `at ${fmt(p.finalUnit)}` : "held so far"}. Deliver {p.winning?.deliveryWindow}.
                </div>
                <TierBar tiers={p.winning!.tiers} committed={p.committed} pending={p.pending} retail={p.product.retailRefCents} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <PlanCard current={seller.plan} mode={payMode()} clientId={process.env.PAYPAL_CLIENT_ID} planIds={ids} />
        <div className="card p-5">
          <h2 className="text-lg font-semibold">Payouts</h2>
          <p className="text-xs text-muted">Sent with PayPal Payouts to {seller.payoutEmail} once the 24-hour window for problems closes.</p>
          {payouts.some((p) => p.po.status === "SENT") && (
            <div className="mt-2">
              <ActionButton action={refreshPayoutsAction} className="btn btn-ghost !py-1 text-xs">
                Check payout status with PayPal
              </ActionButton>
            </div>
          )}
          {!payouts.length ? (
            <p className="mt-4 text-sm text-muted">No payouts yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1">Week</th>
                  <th>Gross</th>
                  <th>Commission</th>
                  <th>Refunds</th>
                  <th>Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {payouts.map(({ po, c }) => (
                  <tr key={po.id}>
                    <td className="py-1.5">{c.weekLabel}</td>
                    <td>{fmt(po.grossCents)}</td>
                    <td>−{fmt(po.commissionCents)}</td>
                    <td>−{fmt(po.refundsCents)}</td>
                    <td className="font-bold">{fmt(po.netCents)}</td>
                    <td>
                      {PAYOUT_STATUS[po.status] ?? po.status}
                      {po.status === "FAILED" && (
                        <ActionButton action={retryPayoutAction.bind(null, po.id)} className="ml-1 text-xs text-brand underline">
                          Retry
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-6 max-w-2xl">
        <SecretaryPanel db={db} cycleId={cycle.id} role="seller" />
      </div>
    </div>
  );
}
