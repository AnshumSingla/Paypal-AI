import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { SOCIETY_ID } from "@/lib/db/seed";
import { fmt } from "@/lib/util/money";
import { startTourAction, switchPersona } from "./actions";
import { societyContext } from "@/lib/queries";
import { TOUR_TOTAL, tourStep } from "@/lib/engine/tour";
import { demoMode } from "@/lib/engine/demo";

const ROLE_COPY: Record<string, { title: string; body: string }> = {
  resident: { title: "Resident", body: "List it, approve once, pay less" },
  captain: { title: "Society captain", body: "Picks and delivery checks" },
  seller: { title: "Supplier", body: "Bids on funded orders" },
  operator: { title: "Operator", body: "Ledger, payouts, analytics" },
};

/** Last week's best example: one item, what residents approved per pack and what they paid. */
async function lastWeekExample(db: Awaited<ReturnType<typeof getDb>>) {
  const [c] = await db.select().from(s.cycle).where(and(eq(s.cycle.societyId, SOCIETY_ID), eq(s.cycle.phase, "CLOSED"))).orderBy(desc(s.cycle.createdAt)).limit(1);
  if (!c) return null;
  const pools = await db
    .select({ p: s.pool, prod: s.product, b: s.bid, sel: s.seller, flats: sql<number>`(select count(distinct bk.household_id) from basket_line bl join basket bk on bk.id = bl.basket_id where bl.pool_id = ${s.pool.id} and bl.status in ('won','refunded_partial','refunded_full'))::int` })
    .from(s.pool)
    .innerJoin(s.product, eq(s.pool.productId, s.product.id))
    .innerJoin(s.bid, eq(s.pool.winningBidId, s.bid.id))
    .innerJoin(s.seller, eq(s.bid.sellerId, s.seller.id))
    .where(and(eq(s.pool.cycleId, c.id), inArray(s.pool.status, ["DELIVERED", "SUCCEEDED"])));
  // The item the most flats joined that actually got cheaper: it shows the building effect best.
  const best = pools.filter((x) => x.p.finalUnitCents! < x.b.tiers[0].unitCents).sort((x, y) => y.flats - x.flats)[0];
  return best ? { week: c.weekLabel, ...best } : null;
}

export default async function Home() {
  const db = await getDb();
  const [personas, ex, { cycle }] = await Promise.all([db.select().from(s.appUser).where(eq(s.appUser.isPersona, true)), lastWeekExample(db), societyContext(db)]);
  const step = demoMode() && cycle ? await tourStep(db, cycle) : null;
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-12 pt-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="max-w-xl">
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Buy together.
            <br />
            Pay less.
          </h1>
          <p className="mt-6 text-xl leading-relaxed text-muted">
            Approve one PayPal hold. Your society&apos;s AI Secretary gets the price down. You pay only what the building unlocked.
          </p>
          {step && (
            <div className="mt-9">
              <div className="flex flex-wrap items-center gap-3">
                <form action={startTourAction.bind(null, false)}>
                  <button className="btn btn-primary !px-7 !py-3.5 text-lg">{step.n === 1 ? "Take the guided tour" : `Continue the tour (${step.n} of ${TOUR_TOTAL})`}</button>
                </form>
                {step.n > 1 && (
                  <form action={startTourAction.bind(null, true)}>
                    <button className="btn btn-ghost !py-3.5">Start over</button>
                  </form>
                )}
              </div>
              <p className="mt-3 text-muted">3 minutes. No sign-in. Sandbox money only.</p>
            </div>
          )}
        </div>

        {ex && (
          <figure className="card p-7 shadow-sm">
            <figcaption className="text-muted">
              Last week at Gulmohar Residency, Pune: <span className="text-ink">{ex.prod.title.toLowerCase()}</span>
            </figcaption>
            <div className="num mt-6 grid grid-cols-2 gap-6">
              <div>
                <div className="label">Approved</div>
                <div className="mt-1 text-3xl text-muted line-through decoration-1">{fmt(ex.b.tiers[0].unitCents)}</div>
              </div>
              <div>
                <div className="label">Paid</div>
                <div className="paid-reveal mt-1 text-5xl font-semibold text-brand" style={{ animationDelay: `${300 + ex.b.tiers.filter((t) => (ex.p.keptQty ?? 0) >= t.minQty).length * 450}ms` }}>
                  {fmt(ex.p.finalUnitCents)}
                </div>
              </div>
            </div>
            {/* The price ladder: each step down is a tier the building's combined order reached. */}
            <ol className="num mt-7 space-y-2" aria-label="Price per pack as more flats join">
              {ex.b.tiers.map((t, i) => {
                const reached = (ex.p.keptQty ?? 0) >= t.minQty;
                return (
                  <li key={t.minQty} className={`flex items-center justify-between rounded-xl px-4 py-2.5 ${reached ? "ladder-step bg-brand-soft text-brand-dark" : "text-muted"}`} style={reached ? { animationDelay: `${300 + i * 450}ms` } : undefined}>
                    <span>{t.minQty}+ packs</span>
                    <span className={reached ? "font-semibold" : ""}>{fmt(t.unitCents)}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-5 text-muted">
              {ex.flats} flats joined. Retail is {fmt(ex.prod.retailRefCents)}.
            </p>
          </figure>
        )}
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="text-2xl font-semibold">
          How it works
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {[
            ["List it", "Type your list or snap a photo of it."],
            ["Approve once", "One PayPal hold for the most you'd pay."],
            ["Pay less", "Charged only the price your building reached."],
          ].map(([t, b], i) => (
            <li key={t} className="card p-6">
              <div className="num flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand-dark">{i + 1}</div>
              <h3 className="mt-4 text-lg font-semibold">{t}</h3>
              <p className="mt-1 text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="try-title">
        <h2 id="try-title" className="text-2xl font-semibold">
          Or look around as
        </h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {personas.map((p) => (
            <form key={p.id} action={switchPersona.bind(null, p.id)}>
              <button className="card flex w-full flex-col items-start p-5 text-left transition-colors hover:border-brand">
                <span className="font-semibold">{ROLE_COPY[p.role].title}</span>
                <span className="mt-0.5 text-muted">{p.name.replace(/ (.*)$/, "")}</span>
                <span className="mt-3 text-sm text-muted">{ROLE_COPY[p.role].body}</span>
              </button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
