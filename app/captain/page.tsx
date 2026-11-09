import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { activityFeed, cycleMoney, poolsView, societyContext } from "@/lib/queries";
import { fmt } from "@/lib/util/money";
import { advancePhase, decideIssueAction, fundedAsksAction, pickWinnerAction } from "@/app/actions";
import { SecretaryPanel } from "@/app/_components/SecretaryPanel";
import { trustScores } from "@/lib/engine/trust";
import { CycleBar } from "@/app/_components/CycleBar";
import { ActionButton } from "@/app/_components/ActionButton";
import { ActivityFeed, Kpi } from "@/app/_components/Bits";
import { PoolGrid } from "./PoolGrid";

export const metadata: Metadata = { title: "Captain console" };

const ISSUE_DECISION: Record<string, string> = { pending: "Waiting for you", auto_approved: "Refunded by the Secretary", approved: "Refunded", rejected: "Rejected" };

export default async function CaptainPage() {
  const { db, user } = await getSession();
  if (!user || !["captain", "operator"].includes(user.role)) redirect("/");
  const { society, cycle } = await societyContext(db);
  if (!cycle) return <p>No cycle yet.</p>;
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

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <CycleBar cycle={cycle} societyName={`${society.name}, captain console`} />
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <Kpi label="Households with needs" value={String(needStats.households)} sub={`${needStats.packs} packs requested${needStats.photo ? `, ${needStats.photo} from photos` : ""}`} />
          <Kpi label="Pools" value={String(pools.length)} sub={`${pools.filter((p) => ["PRICED", "SUCCEEDED", "DELIVERED"].includes(p.status)).length} priced`} />
          <Kpi label={money.captured ? "Charged through PayPal" : "Held in PayPal"} value={money.captured ? fmt(money.captured) : fmt(money.activeHolds)} sub={money.captured ? `of ${fmt(money.held)} held` : `${money.holders} households`} />
          <Kpi label="Saved against retail" value={money.savings ? fmt(money.savings) : "After cutoff"} sub={money.retailEquivalent ? `${Math.round((money.savings / money.retailEquivalent) * 100)}% off ${fmt(money.retailEquivalent)}` : "Known once the week is charged"} accent />
        </div>

        <section className="card mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Demand board</h2>
            <span className="text-xs text-muted">Live from every flat&apos;s basket</span>
          </div>
          {pools.length ? <PoolGrid rows={gridRows} /> : <CollectPreview db={db} cycleId={cycle.id} />}
        </section>

        {cycle.phase === "BID" && <BidReview db={db} cycleId={cycle.id} />}
        {cycle.phase === "COMMIT" && (
          <section className="card p-5">
            <h2 className="text-lg font-semibold">Money on the table</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              {money.holders} households have {fmt(money.activeHolds)} authorized in PayPal right now. The Secretary can take that to the winning suppliers and ask for a lower price at today&apos;s quantity. Prices can only go down, so every hold still covers the final charge.
            </p>
            <div className="mt-4">
              <ActionButton action={fundedAsksAction.bind(null, cycle.id)}>Ask suppliers for a better price</ActionButton>
            </div>
          </section>
        )}
        {cycle.phase === "FULFIL" && <DropManifest db={db} cycleId={cycle.id} cycleIdForAdvance={cycle.id} />}
        {["RESOLVE", "CLOSED"].includes(cycle.phase) && <IssuesQueue db={db} cycleId={cycle.id} />}
      </div>
      <aside className="space-y-4">
        <SecretaryPanel db={db} cycleId={cycle.id} role="captain" />
        <ActivityFeed items={feed} />
        <div className="card p-4 text-sm text-muted">
          <h3 className="mb-1 font-medium text-ink">What you decide</h3>
          Winning bids (or let auto-select take the top-ranked one), the handover, and any refund over $10. You never see anyone&apos;s payment details.
        </div>
      </aside>
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
  return (
    <div>
      <p className="mb-3 text-sm text-muted">Collecting needs. When collection closes, each product becomes a pool for local suppliers to bid on.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.title + r.pack} className="rounded-xl bg-canvas p-3 text-sm">
            <b>{r.title}</b> <span className="text-muted">{r.pack}</span>
            <div className="text-xs text-muted">
              {r.qty} packs from {r.households} households
            </div>
          </div>
        ))}
      </div>
    </div>
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
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Bids to review</h2>
        <span className="chip bg-info-soft text-info">Ranked by code, explained by AI</span>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted">Each score weighs price at today&apos;s demand (40), the supplier&apos;s trust from verified deliveries and upheld complaints (45), and whether the minimum order is reachable (15). The cheapest bid doesn&apos;t win by default. You decide; unpicked pools go to the top score at the deadline.</p>
      <div className="space-y-4">
        {pools.map(({ p, prod }) => {
          const pb = bids.filter((x) => x.b.poolId === p.id).sort((x, y) => (y.b.aiScore ?? 0) - (x.b.aiScore ?? 0));
          return (
            <div key={p.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-medium">
                  {prod.title}
                  {prod.brand ? ` (${prod.brand})` : ""} <span className="font-normal text-muted">{prod.packSize}. {p.demandEstimate} packs wanted, retail {fmt(prod.retailRefCents)}.</span>
                </div>
                {p.status === "PRICED" && <span className="chip bg-brand-soft text-brand-dark">Winner picked</span>}
              </div>
              {p.aiNotes && <p className="mt-1 text-xs text-muted">{p.aiNotes}</p>}
              {p.aiRecommendation && <p className="mt-1 text-sm font-medium text-brand">{p.aiRecommendation}</p>}
              {!pb.length ? (
                <p className="mt-2 text-sm text-muted">No bids yet.</p>
              ) : (
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {pb.map(({ b, sel }, i) => (
                    <li key={b.id} className={`rounded-lg border p-3 text-sm ${b.status === "won" ? "border-brand bg-brand-soft/50" : i === 0 ? "border-info/40" : "border-line"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <b>{sel.businessName}</b>
                        <span className="num chip bg-canvas">Score {b.aiScore ?? ""}</span>
                      </div>
                      <div className="num mt-1 text-xs text-muted">
                        Trust {trust.get(sel.id)}/100. Minimum {b.moq}, capacity {b.maxCapacity}. {b.tiers.map((t) => `${t.minQty}+ at ${fmt(t.unitCents)}`).join(", ")}. {b.deliveryWindow}.
                      </div>
                      {b.aiRationale && <p className="mt-1 text-xs">{b.aiRationale}</p>}
                      {(b.aiFlags ?? []).map((f) => (
                        <p key={f} className="mt-1 text-xs text-danger">
                          {f}
                        </p>
                      ))}
                      {p.status === "OPEN_FOR_BIDS" && (
                        <div className="mt-2">
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
    </section>
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
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Delivery check and packing list</h2>
        <ActionButton action={advancePhase.bind(null, cycleIdForAdvance)} confirm="Confirm the delivery matched this list? That opens the 24-hour window for reporting problems.">
          Confirm handover
        </ActionButton>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium">Check the delivery against</h3>
          <ul className="divide-y divide-line text-sm">
            {[...totals].map(([k, v]) => (
              <li key={k} className="flex justify-between py-1.5">
                <span>{k}</span>
                <span>
                  <b>{v.qty}</b> <span className="text-xs text-muted">from {v.seller}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">Hand out by flat ({byUnit.size})</h3>
          <ul className="max-h-80 space-y-1 overflow-auto text-sm">
            {[...byUnit].map(([unit, items]) => (
              <li key={unit} className="rounded-lg bg-canvas px-3 py-1.5">
                <b>{unit}</b> <span className="text-muted">{items.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
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
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Issues</h2>
        <span className="text-xs text-muted">The Secretary refunds small claims itself; larger ones come to you</span>
      </div>
      {!issues.length ? (
        <p className="text-sm text-muted">No problems reported. Residents have 24 hours after handover.</p>
      ) : (
        <ul className="space-y-3">
          {issues.map(({ i, unit, title }) => (
            <li key={i.id} className="flex flex-wrap gap-4 rounded-xl border border-line p-3 text-sm">
              {i.photoDataUrl && <img src={i.photoDataUrl} alt="Issue" className="h-24 w-24 rounded-lg object-cover" />}
              <div className="min-w-60 flex-1">
                <div className="font-semibold">
                  {unit}: {title}, {i.type.replace("_", " ")}, {i.qtyAffected} pack{i.qtyAffected === 1 ? "" : "s"}
                </div>
                <p className="text-muted">“{i.description}”</p>
                {i.aiAssessment && (
                  <p className="mt-1 text-xs text-info">
                    {i.aiAssessment.rationale} Proposed refund {fmt(i.aiAssessment.proposedRefundCents)} ({i.aiAssessment.confidence} confidence{i.aiAssessment.source === "ai" ? "" : ", rules"}).
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`num chip ${i.decision === "pending" ? "bg-accent-soft text-[#7d5a14]" : i.decision === "rejected" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-dark"}`}>
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
    </section>
  );
}
