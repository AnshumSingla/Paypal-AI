import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { activityFeed, cycleMoney, poolsView, societyContext } from "@/lib/queries";
import { fmt } from "@/lib/util/money";
import { advancePhase, decideIssueAction, pickWinnerAction } from "@/app/actions";
import { CycleBar } from "@/app/_components/CycleBar";
import { ActionButton } from "@/app/_components/ActionButton";
import { ActivityFeed, Kpi } from "@/app/_components/Bits";
import { PoolGrid } from "./PoolGrid";

export const metadata: Metadata = { title: "Captain console" };

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

  const gridRows = pools.map((p) => ({
    id: p.id,
    product: p.product.title, // already includes the brand
    pack: p.product.packSize,
    status: p.status,
    demand: p.demand,
    bids: p.bids,
    seller: p.winning?.sellerName ?? "",
    moq: p.winning?.moq ?? null,
    committed: p.committed,
    unit: p.currentUnit ?? p.ceilingUnit,
    retail: p.product.retailRefCents,
    savings: p.savingsPct,
    note: p.aiNotes ?? "",
  }));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0">
        <CycleBar cycle={cycle} societyName={`${society.name} · Captain console`} />
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <Kpi label="Households with needs" value={String(needStats.households)} sub={`${needStats.packs} packs requested${needStats.photo ? ` · ${needStats.photo} from photos` : ""}`} />
          <Kpi label="Pools" value={String(pools.length)} sub={`${pools.filter((p) => ["PRICED", "SUCCEEDED", "DELIVERED"].includes(p.status)).length} priced`} />
          <Kpi label="PayPal holds / captured" value={money.captured ? fmt(money.captured) : fmt(money.activeHolds)} sub={money.captured ? `of ${fmt(money.held)} held` : `${money.holders} households holding`} />
          <Kpi label="Saved vs retail" value={money.savings ? fmt(money.savings) : "—"} sub={money.retailEquivalent ? `${Math.round((money.savings / money.retailEquivalent) * 100)}% off ${fmt(money.retailEquivalent)}` : "after cutoff"} accent />
        </div>

        <section className="card mb-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold">Demand board</h2>
            <span className="chip bg-info-soft text-info">AG Grid · Pool Builder AI notes</span>
          </div>
          {pools.length ? <PoolGrid rows={gridRows} /> : <CollectPreview db={db} cycleId={cycle.id} />}
        </section>

        {cycle.phase === "BID" && <BidReview db={db} cycleId={cycle.id} />}
        {cycle.phase === "FULFIL" && <DropManifest db={db} cycleId={cycle.id} cycleIdForAdvance={cycle.id} />}
        {["RESOLVE", "CLOSED"].includes(cycle.phase) && <IssuesQueue db={db} cycleId={cycle.id} />}
      </div>
      <aside className="space-y-4">
        <ActivityFeed items={feed} />
        <div className="card p-4 text-xs text-muted">
          <div className="label mb-1">Captain powers</div>
          Approve winning bids (or let auto-select pick the top-ranked unflagged bid), confirm the drop, decide refunds above $10. You never see anyone&apos;s payment details (Policies §12.3).
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
      <p className="mb-3 text-sm text-muted">Collecting needs. When collection closes, the Pool Builder turns these into pools for sellers to bid on.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r.title + r.pack} className="rounded-xl bg-canvas p-3 text-sm">
            <b>{r.title}</b> <span className="text-muted">{r.pack}</span>
            <div className="text-xs text-muted">
              {r.qty} packs · {r.households} households
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
  return (
    <section className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-extrabold">Bids to review</h2>
        <span className="chip bg-info-soft text-info">Bid Analyst · AI</span>
      </div>
      <p className="mb-4 text-sm text-muted">Scores are computed from price at today&apos;s demand, seller reliability and whether the MOQ is reachable. The AI explains each one; you decide. Unpicked pools are auto-selected at the deadline.</p>
      <div className="space-y-4">
        {pools.map(({ p, prod }) => {
          const pb = bids.filter((x) => x.b.poolId === p.id).sort((x, y) => (y.b.aiScore ?? 0) - (x.b.aiScore ?? 0));
          return (
            <div key={p.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-bold">
                  {prod.title}
                  {prod.brand ? ` (${prod.brand})` : ""} <span className="font-normal text-muted">· {prod.packSize} · {p.demandEstimate} packs wanted · retail {fmt(prod.retailRefCents)}</span>
                </div>
                {p.status === "PRICED" && <span className="chip bg-brand-soft text-brand-dark">Winner picked</span>}
              </div>
              {p.aiNotes && <p className="mt-1 text-xs text-muted">Pool Builder: {p.aiNotes}</p>}
              {p.aiRecommendation && <p className="mt-1 text-xs font-semibold text-info">Bid Analyst: {p.aiRecommendation}</p>}
              {!pb.length ? (
                <p className="mt-2 text-sm text-muted">No bids yet.</p>
              ) : (
                <ul className="mt-3 grid gap-2 md:grid-cols-2">
                  {pb.map(({ b, sel }, i) => (
                    <li key={b.id} className={`rounded-lg border p-3 text-sm ${b.status === "won" ? "border-brand bg-brand-soft/50" : i === 0 ? "border-info/40" : "border-line"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <b>{sel.businessName}</b>
                        <span className="chip bg-canvas">score {b.aiScore ?? "—"}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        MOQ {b.moq} · cap {b.maxCapacity} · {b.tiers.map((t) => `${t.minQty}+ ${fmt(t.unitCents)}`).join(" · ")} · {b.deliveryWindow} · {sel.rating / 10}★
                      </div>
                      {b.aiRationale && <p className="mt-1 text-xs">{b.aiRationale}</p>}
                      {(b.aiFlags ?? []).map((f) => (
                        <p key={f} className="mt-1 text-xs text-danger">
                          ⚠ {f}
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
  for (const l of lines) totals.set(`${l.title} · ${l.pack}`, { qty: (totals.get(`${l.title} · ${l.pack}`)?.qty ?? 0) + l.qty, seller: l.seller });
  const byUnit = new Map<string, string[]>();
  for (const l of lines) byUnit.set(l.unit, [...(byUnit.get(l.unit) ?? []), `${l.qty}× ${l.title}`]);
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">Drop manifest &amp; packing list</h2>
        <ActionButton action={advancePhase.bind(null, cycleIdForAdvance)} confirm="Confirm the sellers' drop matched the manifest? This opens the 24h issue window.">
          Confirm handover
        </ActionButton>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="label mb-2">Check the delivery against</div>
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
          <div className="label mb-2">Hand out by unit ({byUnit.size})</div>
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
        <h2 className="text-lg font-extrabold">Issues</h2>
        <span className="chip bg-info-soft text-info">Issue Resolver · AI</span>
      </div>
      {!issues.length ? (
        <p className="text-sm text-muted">No issues reported. Residents have 24h after handover.</p>
      ) : (
        <ul className="space-y-3">
          {issues.map(({ i, unit, title }) => (
            <li key={i.id} className="flex flex-wrap gap-4 rounded-xl border border-line p-3 text-sm">
              {i.photoDataUrl && <img src={i.photoDataUrl} alt="Issue" className="h-24 w-24 rounded-lg object-cover" />}
              <div className="min-w-60 flex-1">
                <div className="font-semibold">
                  {unit}: {title} · {i.type.replace("_", " ")} ×{i.qtyAffected}
                </div>
                <p className="text-muted">“{i.description}”</p>
                {i.aiAssessment && (
                  <p className="mt-1 text-xs text-info">
                    {i.aiAssessment.source === "ai" ? "AI" : "Rules"} ({i.aiAssessment.confidence} confidence): {i.aiAssessment.rationale} Proposed refund {fmt(i.aiAssessment.proposedRefundCents)}.
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`chip ${i.decision === "pending" ? "bg-accent-soft text-[#8a5a12]" : i.decision === "rejected" ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand-dark"}`}>
                  {i.decision.replace("_", " ")}
                  {i.refundCents ? ` · ${fmt(i.refundCents)}` : ""}
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
