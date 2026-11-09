import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { SOCIETY_ID } from "@/lib/db/seed";
import { fmt } from "@/lib/util/money";
import { switchPersona } from "./actions";

const ROLE_COPY: Record<string, { title: string; body: string }> = {
  resident: { title: "Resident", body: "Photograph your list, approve one PayPal hold, and pay the price the building unlocked." },
  captain: { title: "Society captain", body: "See what the building needs, check the Secretary's supplier picks, and confirm the delivery." },
  seller: { title: "Supplier", body: "Bid on orders that residents have already approved in PayPal, and get paid out after delivery." },
  operator: { title: "Operator", body: "The ledger, payouts, supplier approvals, and a dashboard you can question in plain English." },
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
  const [personas, ex] = await Promise.all([db.select().from(s.appUser).where(eq(s.appUser.isPersona, true)), lastWeekExample(db)]);
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold leading-[1.1] sm:text-5xl">Your society buys groceries in bulk, together.</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            Forty flats buy the same rice, dal and oil every week, one by one, at retail prices. Collective pools those lists into one order. Each resident approves a single PayPal hold for the most they&apos;d pay, an AI Society Secretary gets trusted local suppliers to compete, and PayPal charges only the price the whole building unlocked.
          </p>
        </div>

        {ex && (
          <figure className="card p-6">
            <figcaption className="text-sm text-muted">
              {ex.week} at Gulmohar Residency: {ex.prod.title.toLowerCase()}, {ex.prod.packSize}
            </figcaption>
            <div className="num mt-5 grid grid-cols-2 gap-6">
              <div>
                <div className="label">Approved, per pack</div>
                <div className="mt-1 text-3xl text-muted line-through decoration-1">{fmt(ex.b.tiers[0].unitCents)}</div>
              </div>
              <div>
                <div className="label">Paid, per pack</div>
                <div className="mt-1 text-3xl font-semibold text-brand">{fmt(ex.p.finalUnitCents)}</div>
              </div>
            </div>
            {/* The price ladder: each step down is a tier the building's combined order reached. */}
            <ol className="num mt-6 space-y-1.5" aria-label="Price tiers">
              {ex.b.tiers.map((t) => {
                const reached = (ex.p.keptQty ?? 0) >= t.minQty;
                return (
                  <li key={t.minQty} className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${reached ? "bg-brand-soft text-brand-dark" : "text-muted"}`}>
                    <span>{t.minQty}+ packs</span>
                    <span className={reached ? "font-medium" : ""}>{fmt(t.unitCents)}</span>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-sm text-muted">
              {ex.flats} flats joined for {ex.p.keptQty} packs from {ex.sel.businessName}. Retail is {fmt(ex.prod.retailRefCents)}.
            </p>
          </figure>
        )}
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title" className="text-xl font-semibold">
          How a week works
        </h2>
        <ol className="mt-5 grid gap-8 sm:grid-cols-3">
          {[
            ["Say what you need", "Type your list or photograph a handwritten one. Claude turns it into products and quantities, and blocks anything that can't be sold."],
            ["Approve once with PayPal", "One hold covers the highest price your items could cost. You never pay more than that, and usually pay less."],
            ["The Secretary does the rest", "It picks suppliers by price and track record, asks them for a better price with the money already approved, and refunds small problems itself."],
          ].map(([t, b], i) => (
            <li key={t}>
              <div className="text-sm text-muted">Step {i + 1}</div>
              <h3 className="mt-1 font-semibold">{t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="try-title">
        <h2 id="try-title" className="text-xl font-semibold">
          See it as
        </h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {personas.map((p) => (
            <form key={p.id} action={switchPersona.bind(null, p.id)} className="card flex flex-col p-5">
              <div className="text-sm text-muted">{ROLE_COPY[p.role].title}</div>
              <div className="mt-1 font-semibold">{p.name}</div>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{ROLE_COPY[p.role].body}</p>
              <button className="btn btn-ghost mt-5">Open {ROLE_COPY[p.role].title.toLowerCase()} view</button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
