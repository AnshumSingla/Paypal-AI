import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { PackageOpen, Percent, RefreshCw, ShieldAlert, Sparkles, Trophy, Wallet } from "lucide-react";
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
import { TierBar } from "@/app/_components/TierBar";
import { Empty, Panel, Stat, StatRow } from "@/app/_components/ui";
import { BidBuilder } from "./BidBuilder";
import { PlanCard } from "./PlanCard";
import { SecretaryPanel } from "@/app/_components/SecretaryPanel";

export const metadata: Metadata = { title: "Supplier portal" };

const POOL_STATUS: Record<string, string> = { PRICED: "Taking orders", SUCCEEDED: "Ordered", DELIVERED: "Delivered", FAILED: "Missed minimum", SELLER_DEFAULTED: "Not delivered" };
const POOL_TONE: Record<string, string> = { PRICED: "bg-accent-soft text-accent-ink", SUCCEEDED: "bg-success-soft text-success", DELIVERED: "bg-success-soft text-success", FAILED: "bg-danger-soft text-danger", SELLER_DEFAULTED: "bg-danger-soft text-danger" };
const PAYOUT_STATUS: Record<string, string> = { SUCCESS: "Paid", SENT: "Sent", PENDING: "Pending", FAILED: "Failed", CARRIED_FORWARD: "Carried forward" };
const PAYOUT_TONE: Record<string, string> = { SUCCESS: "bg-success-soft text-success", SENT: "bg-brand-soft text-brand-dark", PENDING: "bg-accent-soft text-accent-ink", FAILED: "bg-danger-soft text-danger", CARRIED_FORWARD: "bg-accent-soft text-accent-ink" };

export default async function SellerPage({ searchParams }: { searchParams: Promise<{ pool?: string }> }) {
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

  const open = pools.filter((p) => p.status === "OPEN_FOR_BIDS");
  const paidOut = payouts.filter((p) => ["SUCCESS", "SENT"].includes(p.po.status)).reduce((a, p) => a + p.po.netCents, 0);
  const bidding = cycle.phase === "BID";
  // One pool's bid form at a time: the one picked in the list, else the first without a bid from you.
  const picked = (await searchParams).pool;
  const sel = open.find((p) => p.id === picked) ?? open.find((p) => !bidByPool.has(p.id)) ?? open[0];
  const selBid = sel ? bidByPool.get(sel.id) : undefined;

  return (
    <div>
      <CycleBar cycle={cycle} societyName={`${seller.businessName}, supplying ${society.name}`} />
      {seller.status !== "approved" && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-accent bg-accent-soft p-4 text-sm text-accent-ink" role="status">
          <ShieldAlert size={20} aria-hidden className="shrink-0" />
          <p>Your supplier account is {seller.status}. An operator approves new suppliers before they can bid.</p>
        </div>
      )}

      <StatRow>
        <Stat icon={<PackageOpen size={20} aria-hidden />} tone="brand" title="Open pools" value={open.length} sentence={`${myBids.filter((b) => b.status === "submitted").length} with your bid`} href={bidding ? "#open-pools" : undefined} action="Bid on pools" />
        <Stat icon={<Trophy size={20} aria-hidden />} tone="success" title="Pools won" value={won.length} sentence={`in ${cycle.weekLabel}`} href={won.length ? "#your-pools" : undefined} action="Track your pools" />
        <Stat icon={<Percent size={20} aria-hidden />} tone="ink" title="Commission" value={`${COMMISSION_BPS[seller.plan] / 100}%`} sentence={`on the ${seller.plan} plan`} href="#plan" action="Change plan" />
        <Stat icon={<Wallet size={20} aria-hidden />} tone={seller.balanceCents < 0 ? "danger" : "brand"} title="Paid out" value={fmt(paidOut)} sentence={seller.balanceCents < 0 ? `balance ${fmt(seller.balanceCents)}` : "all time, via PayPal Payouts"} href="#payouts" action="See payouts" />
      </StatRow>

      <div className="space-y-6">
        {bidding && (
          <div id="open-pools" className="grid scroll-mt-24 items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Panel title="Open for bids" description="Totals only, never who ordered." aside={<span className="chip bg-surface-2 text-muted">{open.length}</span>} flush>
              {!open.length ? (
                <Empty icon={<PackageOpen size={20} aria-hidden />} title="No pools open for bids" />
              ) : (
                <ul className="divide-y divide-line">
                  {open.map((p) => {
                    const mine = bidByPool.get(p.id);
                    const active = p.id === sel?.id;
                    return (
                      <li key={p.id}>
                        <Link href={`?pool=${p.id}#bid`} scroll={false} aria-current={active ? "true" : undefined} className={`flex items-center justify-between gap-3 px-5 py-3 transition-colors ${active ? "bg-brand-soft" : "hover:bg-surface-2"}`}>
                          <span className="min-w-0">
                            <span className={`block truncate font-medium ${active ? "text-brand-dark" : ""}`}>{p.product.title}</span>
                            <span className="num block text-sm text-muted">
                              {p.demand} packs, retail {fmt(p.product.retailRefCents)}
                            </span>
                          </span>
                          {mine ? <span className="chip shrink-0 bg-success-soft text-success">Bid in</span> : <span className="chip shrink-0 bg-surface-2 text-muted">{p.bids} bids</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            {sel && (
              <div className="lg:sticky lg:top-20">
                <Panel
                  id="bid"
                  title={`${selBid ? "Your bid" : "Bid"}: ${sel.product.title}`}
                  description={`${sel.product.packSize}. ${sel.demand} packs wanted, retail ${fmt(sel.product.retailRefCents)}, ${sel.bids} bid${sel.bids === 1 ? "" : "s"} so far.`}
                  aside={
                    selBid?.status === "submitted" ? (
                      <ActionButton action={withdrawBidAction.bind(null, selBid.id)} className="btn btn-ghost !py-1 text-sm">
                        Withdraw
                      </ActionButton>
                    ) : null
                  }
                >
                  {(sel.aiNotes || selBid) && (
                    <div className="mb-5 space-y-2">
                      {sel.aiNotes && (
                        <p className="flex items-start gap-2 rounded-lg bg-info-soft p-3 text-sm text-info">
                          <Sparkles size={16} aria-hidden className="mt-0.5 shrink-0" />
                          {sel.aiNotes}
                        </p>
                      )}
                      {selBid && (
                        <p className="text-sm">
                          <span className="chip bg-info-soft text-info">Score {selBid.aiScore ?? "-"}</span>
                          {(selBid.aiFlags ?? []).map((f) => (
                            <span key={f} className="ml-2 text-danger">
                              {f}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                  )}
                  <BidBuilder key={sel.id} poolId={sel.id} demand={sel.demand} retailCents={sel.product.retailRefCents} title={sel.product.title} existing={selBid && selBid.status === "submitted" ? selBid : undefined} />
                </Panel>
              </div>
            )}
          </div>
        )}

        {won.length > 0 && (
          <Panel id="your-pools" title="Your pools this week" description="Live progress toward each price break.">
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {won.map((p) => (
                <li key={p.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold">{p.product.title}</h3>
                    <span className={`chip ${POOL_TONE[p.status] ?? "bg-surface-2 text-ink"}`}>{POOL_STATUS[p.status] ?? p.status}</span>
                  </div>
                  <p className="num mb-4 mt-1 text-sm text-muted">
                    {p.committed} packs {p.finalUnit ? `at ${fmt(p.finalUnit)}` : "held so far"}. Deliver {p.winning?.deliveryWindow}.
                  </p>
                  <TierBar tiers={p.winning!.tiers} committed={p.committed} pending={p.pending} retail={p.product.retailRefCents} />
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <PlanCard current={seller.plan} mode={payMode()} clientId={process.env.PAYPAL_CLIENT_ID} planIds={ids} />
          <Panel
            id="payouts"
            title="Payouts"
            description={`Sent to ${seller.payoutEmail} after the 24-hour window for problems.`}
            aside={
              payouts.some((p) => p.po.status === "SENT") ? (
                <ActionButton action={refreshPayoutsAction} className="btn btn-ghost !py-1 text-sm">
                  <RefreshCw size={16} aria-hidden /> Check with PayPal
                </ActionButton>
              ) : null
            }
            flush
          >
            {!payouts.length ? (
              <Empty icon={<Wallet size={20} aria-hidden />} title="No payouts yet" />
            ) : (
              <ul className="divide-y divide-line">
                {payouts.map(({ po, c }) => (
                  <li key={po.id} className="px-6 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{c.weekLabel}</span>
                      <span className="num font-semibold">{fmt(po.netCents)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="num text-sm text-muted">
                        Gross {fmt(po.grossCents)}, commission −{fmt(po.commissionCents)}, refunds −{fmt(po.refundsCents)}
                      </span>
                      <span className={`chip ${PAYOUT_TONE[po.status] ?? "bg-surface-2 text-ink"}`}>{PAYOUT_STATUS[po.status] ?? po.status}</span>
                    </div>
                    {po.status === "FAILED" && (
                      <div className="mt-2">
                        <ActionButton action={retryPayoutAction.bind(null, po.id)} className="btn btn-ghost !py-1 text-sm">
                          <RefreshCw size={16} aria-hidden /> Retry payout
                        </ActionButton>
                      </div>
                    )}
                    {po.paypalBatchId && <p className="mono mt-1 truncate text-sm text-subtle">Batch {po.paypalBatchId}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <SecretaryPanel db={db} cycleId={cycle.id} role="seller" />
      </div>
    </div>
  );
}
