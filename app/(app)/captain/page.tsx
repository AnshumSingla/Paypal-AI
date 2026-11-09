import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Boxes, Check, CircleCheck, HandCoins, PiggyBank, ShoppingBasket, Sparkles, TriangleAlert, Users, Wallet } from "lucide-react";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { activityFeed, cycleMoney, poolsView, societyContext } from "@/lib/queries";
import { fmt } from "@/lib/util/money";
import { advancePhase, decideIssueAction, fundedAsksAction, pickWinnerAction } from "@/app/actions";
import { SecretaryPanel } from "@/app/_components/SecretaryPanel";
import { trustScores } from "@/lib/engine/trust";
import { CycleBar } from "@/app/_components/CycleBar";
import { WeekTimeline } from "@/app/_components/WeekTimeline";
import { weekSchedule } from "@/lib/schedule";
import { ActionButton } from "@/app/_components/ActionButton";
import { ActivityFeed } from "@/app/_components/Bits";
import { Empty, Panel, Stat, StatRow } from "@/app/_components/ui";
import { PoolGrid } from "./PoolGrid";
import { AutoRefresh } from "@/app/_components/AutoRefresh";

export const metadata: Metadata = { title: "Captain console" };

const ISSUE_DECISION: Record<string, string> = { pending: "Waiting for you", auto_approved: "Refunded by the Secretary", approved: "Refunded", rejected: "Rejected" };
const ISSUE_TONE: Record<string, string> = { pending: "bg-accent-soft text-accent-ink", rejected: "bg-danger-soft text-danger", approved: "bg-success-soft text-success", auto_approved: "bg-success-soft text-success" };

/** Where the pools card points, by phase: the section the captain acts on next. */
const PHASE_TARGET: Record<string, { href: string; action: string }> = {
  BID: { href: "#bids", action: "Review bids" },
  COMMIT: { href: "#money", action: "Ask for better prices" },
  FULFIL: { href: "#delivery", action: "Check the delivery" },
  RESOLVE: { href: "#issues", action: "Decide issues" },
  CLOSED: { href: "#issues", action: "See issues" },
};

export default async function CaptainPage() {
  const { db, user } = await getSession();
  if (!user || !["captain", "operator"].includes(user.role)) redirect("/");
  const { society, cycle } = await societyContext(db);
  if (!cycle)
    return (
      <div className="card">
        <Empty icon={<ShoppingBasket size={20} aria-hidden />} title="No cycle yet" />
      </div>
    );
  const [pools, money, feed] = await Promise.all([poolsView(db, cycle.id), cycleMoney(db, cycle.id), activityFeed(db, cycle.id, 14)]);
  const [needStats] = await db
    .select({ households: sql<number>`count(distinct ${s.need.householdId})::int`, packs: sql<number>`coalesce(sum(${s.need.qty}),0)::int`, photo: sql<number>`count(*) filter (where ${s.need.source} = 'photo')::int` })
    .from(s.need)
    .where(and(eq(s.need.cycleId, cycle.id), eq(s.need.status, "active")));

  const trust = await trustScores(db, "seller", [...new Set(pools.map((p) => p.winning?.sellerId).filter(Boolean) as string[])]);
  const gridRows = pools.map((p) => ({
    id: p.id,
    product: p.product.title, // already includes the brand
    pack: p.product.packSize,
    status: p.status,
    demand: p.demand,
    bids: p.bids,
    seller: p.winning?.sellerName ?? "",
    trust: p.winning ? (trust.get(p.winning.sellerId) ?? null) : null,
    moq: p.winning?.moq ?? null,
    committed: p.committed,
    unit: p.currentUnit ?? p.ceilingUnit,
    nextNeeded: p.status === "PRICED" ? (p.next?.needed ?? null) : null,
    nextUnit: p.status === "PRICED" ? (p.next?.unitCents ?? null) : null,
    retail: p.product.retailRefCents,
    savings: p.savingsPct,
    note: p.aiNotes ?? "",
  }));
  const priced = pools.filter((p) => ["PRICED", "SUCCEEDED", "DELIVERED"].includes(p.status)).length;
  const target = PHASE_TARGET[cycle.phase];

  return (
    <div>
      <CycleBar cycle={cycle} societyName={`${society.name}, captain console`} />
      {cycle.phase === "COMMIT" && <AutoRefresh />}

      <StatRow>
        <Stat
          icon={<Users size={20} aria-hidden />}
          title="Households with needs"
          value={needStats.households}
          sentence={`${needStats.packs} packs requested${needStats.photo ? `, ${needStats.photo} from photos` : ""}`}
          href="#demand"
          action="Open demand board"
        />
        <Stat icon={<Boxes size={20} aria-hidden />} tone="info" title="Pools" value={pools.length} sentence={`${priced} priced`} href={target?.href} action={target?.action} />
        <Stat
          icon={<Wallet size={20} aria-hidden />}
          tone="brand"
          title={money.captured ? "Charged through PayPal" : "Held in PayPal"}
          value={money.captured ? fmt(money.captured) : fmt(money.activeHolds)}
          sentence={money.captured ? `of ${fmt(money.held)} held` : `from ${money.holders} households`}
        />
        <Stat
          icon={<PiggyBank size={20} aria-hidden />}
          tone="success"
          title="Saved against retail"
          value={money.savings ? fmt(money.savings) : "After cutoff"}
          sentence={money.retailEquivalent ? `${Math.round((money.savings / money.retailEquivalent) * 100)}% off ${fmt(money.retailEquivalent)}` : "Known once the week is charged"}
        />
      </StatRow>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel
            id="demand"
            title="Demand board"
            description={pools.length ? "Live from every flat's basket." : "Collecting needs. Each product becomes a pool when collection closes."}
            aside={pools.length ? <span className="num chip bg-surface-2 text-ink">{pools.length} pools</span> : null}
            flush={!pools.length}
          >
            {pools.length ? <PoolGrid rows={gridRows} /> : <CollectPreview db={db} cycleId={cycle.id} />}
          </Panel>

          {cycle.phase === "BID" && <BidReview db={db} cycleId={cycle.id} />}
          {cycle.phase === "COMMIT" && (
            <Panel id="money" title="Money on the table" description="The Secretary takes the authorized total to the winning suppliers and asks for a lower price at today's quantity.">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="num text-3xl font-semibold tracking-tight text-brand">{fmt(money.activeHolds)}</span>
                  <span className="ml-2 text-muted">authorized by {money.holders} households</span>
                  <p className="mt-1 text-sm text-muted">Prices only go down, so every hold still covers the final charge.</p>
                </div>
                <ActionButton action={fundedAsksAction.bind(null, cycle.id)}>
                  <HandCoins size={18} aria-hidden /> Ask suppliers for a better price
                </ActionButton>
              </div>
            </Panel>
          )}
          {cycle.phase === "FULFIL" && <DropManifest db={db} cycleId={cycle.id} cycleIdForAdvance={cycle.id} />}
          {["RESOLVE", "CLOSED"].includes(cycle.phase) && <IssuesQueue db={db} cycleId={cycle.id} />}

          <WeekTimeline schedule={weekSchedule(cycle, society.dropPoint)} />
        </div>

        <aside className="space-y-6" aria-label="Secretary and activity">
          <SecretaryPanel db={db} cycleId={cycle.id} role="captain" />
          <ActivityFeed items={feed} />
          <Panel title="What you decide" description="You never see anyone's payment details.">
            <ul className="space-y-2 text-sm">
              {["Winning bids, or let auto-select take the top-ranked one", "The handover", "Any refund over $10"].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check size={18} className="mt-0.5 shrink-0 text-brand" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

async function CollectPreview({ db, cycleId }: { db: Awaited<ReturnType<typeof getSession>>["db"]; cycleId: string }) {
  const rows = await db
    .select({ title: s.product.title, pack: s.product.packSize, qty: sql<number>`sum(${s.need.qty})::int`, households: sql<number>`count(distinct ${s.need.householdId})::int` })
    .from(s.need)
    .innerJoin(s.product, eq(s.need.productId, s.product.id))
    .where(and(eq(s.need.cycleId, cycleId), eq(s.need.status, "active")))
    .groupBy(s.product.title, s.product.packSize)
    .orderBy(sql`sum(${s.need.qty}) desc`);
  if (!rows.length) return <Empty icon={<ShoppingBasket size={20} aria-hidden />} title="No needs yet">Needs appear here as flats add them to their baskets.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.title + r.pack} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3 text-sm">
          <span>
            <span className="font-medium">{r.title}</span> <span className="text-muted">{r.pack}</span>
          </span>
          <span className="num">
            <span className="font-semibold">{r.qty}</span> <span className="text-muted">packs from {r.households} households</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

async function BidReview({ db, cycleId }: { db: Awaited<ReturnType<typeof getSession>>["db"]; cycleId: string }) {
  const pools = await db.select({ p: s.pool, prod: s.product }).from(s.pool).innerJoin(s.product, eq(s.pool.productId, s.product.id)).where(and(eq(s.pool.cycleId, cycleId), inArray(s.pool.status, ["OPEN_FOR_BIDS", "PRICED"])))
    .orderBy(desc(s.pool.demandEstimate));
  const bids = await db
    .select({ b: s.bid, sel: s.seller })
    .from(s.bid)
    .innerJoin(s.seller, eq(s.bid.sellerId, s.seller.id))
    .where(and(inArray(s.bid.poolId, pools.map((p) => p.p.id).concat("-")), inArray(s.bid.status, ["submitted", "won"])));
  const trust = await trustScores(db, "seller", [...new Set(bids.map((x) => x.sel.id))]);
  return (
    <Panel
      id="bids"
      title="Bids to review"
      description="Pick one bid per pool. Unpicked pools go to the top score at the deadline."
      aside={<span className="chip bg-info-soft text-info">Ranked by code, explained by AI</span>}
      flush
    >
      <details className="border-b border-line px-6 py-3 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">How the score works</summary>
        <p className="mt-2 max-w-3xl">Price at today&apos;s demand counts 40, the supplier&apos;s trust from verified deliveries and upheld complaints 45, and whether the minimum order is reachable 15. The cheapest bid doesn&apos;t win by default.</p>
      </details>
      {!pools.length && <Empty icon={<Boxes size={20} aria-hidden />} title="No pools open for bids" />}
      <div className="divide-y divide-line">
        {pools.map(({ p, prod }) => {
          const pb = bids.filter((x) => x.b.poolId === p.id).sort((x, y) => (y.b.aiScore ?? 0) - (x.b.aiScore ?? 0));
          return (
            <div key={p.id} className="px-6 py-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">
                    {prod.title}
                    {prod.brand ? ` (${prod.brand})` : ""}
                  </h3>
                  <p className="num mt-0.5 text-sm text-muted">
                    {prod.packSize}, {p.demandEstimate} packs wanted, retail {fmt(prod.retailRefCents)}
                    {prod.retailSource === "channel3" ? " (Channel3)" : ""}
                  </p>
                </div>
                {p.status === "PRICED" && (
                  <span className="chip bg-success-soft text-success">
                    <CircleCheck size={16} aria-hidden /> Winner picked
                  </span>
                )}
              </div>
              {p.aiRecommendation && (
                <p className="mt-3 flex gap-2 text-sm font-medium text-info">
                  <Sparkles size={18} className="mt-0.5 shrink-0" aria-hidden />
                  {p.aiRecommendation}
                </p>
              )}
              {p.aiNotes && <p className="mt-1 text-xs text-muted">{p.aiNotes}</p>}
              {!pb.length ? (
                <p className="mt-3 text-sm text-muted">No bids yet.</p>
              ) : (
                <ul className="mt-4 grid gap-3 md:grid-cols-2">
                  {pb.map(({ b, sel }, i) => (
                    <li key={b.id} className={`flex flex-col rounded-xl border p-4 text-sm ${b.status === "won" ? "border-success bg-success-soft" : i === 0 ? "border-info" : "border-line"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold">{sel.businessName}</span>
                        <span className="flex shrink-0 gap-1.5">
                          {b.status === "won" ? <span className="chip bg-surface text-success">Picked</span> : i === 0 ? <span className="chip bg-info-soft text-info">Top score</span> : null}
                          <span className="num chip bg-surface-2 text-ink">Score {b.aiScore ?? ""}</span>
                        </span>
                      </div>
                      <dl className="num mt-3 grid grid-cols-3 gap-2">
                        <div>
                          <dt className="text-xs text-muted">Trust</dt>
                          <dd className="font-semibold">{trust.get(sel.id)}/100</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Minimum</dt>
                          <dd className="font-semibold">{b.moq}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Capacity</dt>
                          <dd className="font-semibold">{b.maxCapacity}</dd>
                        </div>
                      </dl>
                      <p className="num mt-2 text-xs text-muted">
                        {b.tiers.map((t) => `${t.minQty}+ at ${fmt(t.unitCents)}`).join(", ")}. {b.deliveryWindow}.
                      </p>
                      {(b.aiFlags ?? []).map((f) => (
                        <p key={f} className="mt-2 flex gap-1.5 text-xs text-danger">
                          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
                          {f}
                        </p>
                      ))}
                      {b.aiRationale && (
                        <details className="mt-2 text-xs" open={i === 0}>
                          <summary className="cursor-pointer font-medium text-info">Why this score</summary>
                          <p className="mt-1 text-muted">{b.aiRationale}</p>
                        </details>
                      )}
                      {p.status === "OPEN_FOR_BIDS" && (
                        <div className="mt-auto pt-3">
                          <ActionButton action={pickWinnerAction.bind(null, p.id, b.id)} className="btn btn-ghost !py-1 text-xs">
                            Pick this bid
                          </ActionButton>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

async function DropManifest({ db, cycleId, cycleIdForAdvance }: { db: Awaited<ReturnType<typeof getSession>>["db"]; cycleId: string; cycleIdForAdvance: string }) {
  const lines = await db
    .select({ unit: s.household.unitLabel, title: s.product.title, pack: s.product.packSize, qty: s.basketLine.qty, seller: s.seller.businessName })
    .from(s.basketLine)
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .innerJoin(s.household, eq(s.basket.householdId, s.household.id))
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .innerJoin(s.seller, eq(s.bid.sellerId, s.seller.id))
    .where(and(eq(s.basket.cycleId, cycleId), eq(s.basketLine.status, "won")))
    .orderBy(s.household.unitLabel);
  const totals = new Map<string, { qty: number; seller: string }>();
  for (const l of lines) totals.set(`${l.title}, ${l.pack}`, { qty: (totals.get(`${l.title}, ${l.pack}`)?.qty ?? 0) + l.qty, seller: l.seller });
  const byUnit = new Map<string, string[]>();
  for (const l of lines) byUnit.set(l.unit, [...(byUnit.get(l.unit) ?? []), `${l.qty} × ${l.title}`]);
  return (
    <Panel
      id="delivery"
      title="Delivery check and packing list"
      description="Count the delivery against this list, then hand out by flat."
      aside={
        <ActionButton action={advancePhase.bind(null, cycleIdForAdvance)} confirm="Confirm the delivery matched this list? That opens the 24-hour window for reporting problems.">
          Confirm handover
        </ActionButton>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-base font-semibold">Check the delivery against</h3>
          <ul className="divide-y divide-line text-sm">
            {[...totals].map(([k, v]) => (
              <li key={k} className="flex items-baseline justify-between gap-3 py-2">
                <span>{k}</span>
                <span className="num shrink-0 text-right">
                  <span className="font-semibold">{v.qty}</span> <span className="text-xs text-muted">from {v.seller}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-base font-semibold">
            Hand out by flat <span className="num font-normal text-muted">({byUnit.size})</span>
          </h3>
          <ul className="max-h-80 divide-y divide-line overflow-auto text-sm">
            {[...byUnit].map(([unit, items]) => (
              <li key={unit} className="flex gap-3 py-2">
                <span className="num w-16 shrink-0 font-semibold">{unit}</span>
                <span className="text-muted">{items.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

async function IssuesQueue({ db, cycleId }: { db: Awaited<ReturnType<typeof getSession>>["db"]; cycleId: string }) {
  const issues = await db
    .select({ i: s.issue, unit: s.household.unitLabel, title: s.product.title, l: s.basketLine })
    .from(s.issue)
    .innerJoin(s.basketLine, eq(s.issue.basketLineId, s.basketLine.id))
    .innerJoin(s.basket, eq(s.basketLine.basketId, s.basket.id))
    .innerJoin(s.household, eq(s.basket.householdId, s.household.id))
    .innerJoin(s.pool, eq(s.basketLine.poolId, s.pool.id))
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .where(eq(s.basket.cycleId, cycleId));
  const waiting = issues.filter(({ i }) => i.decision === "pending").length;
  return (
    <Panel
      id="issues"
      title="Issues"
      description="The Secretary refunds small claims itself; larger ones come to you."
      aside={waiting ? <span className="num chip bg-accent-soft text-accent-ink">{waiting} waiting for you</span> : null}
      flush
    >
      {!issues.length ? (
        <Empty icon={<CircleCheck size={20} aria-hidden />} title="No problems reported">
          Residents have 24 hours after handover.
        </Empty>
      ) : (
        <ul className="divide-y divide-line">
          {issues.map(({ i, unit, title }) => (
            <li key={i.id} className="flex flex-wrap gap-4 px-6 py-4 text-sm">
              {i.photoDataUrl && <img src={i.photoDataUrl} alt={`Photo of the ${title} problem from ${unit}`} className="h-20 w-20 rounded-lg border border-line object-cover" />}
              <div className="min-w-60 flex-1">
                <h3 className="text-base font-semibold">
                  {unit}: {title}
                </h3>
                <p className="num text-muted">
                  {i.type.replace("_", " ")}, {i.qtyAffected} pack{i.qtyAffected === 1 ? "" : "s"}
                </p>
                <p className="mt-1">“{i.description}”</p>
                {i.aiAssessment && (
                  <div className="mt-2 rounded-lg bg-info-soft px-3 py-2 text-xs">
                    <p className="num flex gap-1.5 font-medium text-info">
                      <Sparkles size={16} className="mt-0.5 shrink-0" aria-hidden />
                      Proposed refund {fmt(i.aiAssessment.proposedRefundCents)}, {i.aiAssessment.confidence} confidence{i.aiAssessment.source === "ai" ? "" : ", rules"}
                    </p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted">Secretary&apos;s reasoning</summary>
                      <p className="mt-1 text-ink">{i.aiAssessment.rationale}</p>
                    </details>
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`num chip ${ISSUE_TONE[i.decision] ?? "bg-surface-2 text-ink"}`}>
                  {ISSUE_DECISION[i.decision]}
                  {i.refundCents ? ` ${fmt(i.refundCents)}` : ""}
                </span>
                {i.decision === "pending" && (
                  <div className="flex gap-2">
                    <ActionButton action={decideIssueAction.bind(null, i.id, true, undefined)} className="btn btn-primary !py-1 text-xs">
                      Refund {fmt(i.aiAssessment?.proposedRefundCents ?? 0)}
                    </ActionButton>
                    <ActionButton action={decideIssueAction.bind(null, i.id, false, undefined)} className="btn btn-ghost !py-1 text-xs">
                      Reject
                    </ActionButton>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
