import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { SOCIETY_ID } from "@/lib/db/seed";
import { fmt } from "@/lib/util/money";
import { startTourAction, switchPersona } from "@/app/actions";
import { societyContext } from "@/lib/queries";
import { TOUR_TOTAL, tourStep } from "@/lib/engine/tour";
import { demoMode } from "@/lib/engine/demo";
import { landingFacts } from "@/lib/landing";
import { PendingButton } from "@/app/_components/PendingButton";

const ROLE_COPY: Record<string, { title: string; body: string }> = {
  resident: { title: "Resident", body: "Lists, one PayPal hold, the receipt." },
  captain: { title: "Society captain", body: "Supplier picks, delivery, escalations." },
  seller: { title: "Supplier", body: "Bids on orders already funded." },
  operator: { title: "Operator", body: "Ledger, payouts, analytics." },
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
  const [personas, ex, { cycle }, facts] = await Promise.all([db.select().from(s.appUser).where(eq(s.appUser.isPersona, true)), lastWeekExample(db), societyContext(db), landingFacts(db)]);
  const step = demoMode() && cycle ? await tourStep(db, cycle) : null;
  const top = facts.trust[0]?.score ?? 100;
  return (
    <div className="space-y-24 pb-8">
      {/* Hero: full-bleed slanted band, the promise in white on the deep end, the product floating on the light end. */}
      <section className="relative left-1/2 -mt-8 w-screen -translate-x-1/2 overflow-hidden pb-20">
        <div className="hero-band" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pt-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="text-white">
            <p className="rise font-semibold text-white/80">For housing societies, built on PayPal</p>
            <h1 className="h-display rise mt-4 text-white" style={{ "--d": "60ms" } as React.CSSProperties}>
              Buy together.
              <br />
              Pay less.
            </h1>
            <p className="rise mt-6 max-w-[33rem] text-xl leading-relaxed text-white/85" style={{ "--d": "140ms" } as React.CSSProperties}>
              Each flat approves one PayPal hold. An AI Secretary gets suppliers to lower the price. PayPal charges only what the whole building unlocked.
            </p>
            {step && (
              <div className="rise mt-9 flex flex-wrap items-center gap-3" style={{ "--d": "220ms" } as React.CSSProperties}>
                <form action={startTourAction.bind(null, false)}>
                  <button className="btn group !bg-white !px-6 !py-3 text-lg !text-[#0a2540] hover:!bg-white/90">
                    {step.n === 1 ? "Take the guided tour" : `Continue the tour (${step.n} of ${TOUR_TOTAL})`}
                    <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                      ›
                    </span>
                  </button>
                </form>
                {step.n > 1 ? (
                  <form action={startTourAction.bind(null, true)}>
                    <PendingButton className="btn !border !border-white/40 !bg-transparent !py-3 !text-white hover:!bg-white/10" pendingLabel="Resetting the week…">
                      Start over
                    </PendingButton>
                  </form>
                ) : (
                  <a href="#why" className="btn !border !border-white/40 !py-3 !text-white hover:!bg-white/10">
                    Why it works
                  </a>
                )}
              </div>
            )}
            <p className="rise mt-4 text-white/75" style={{ "--d": "260ms" } as React.CSSProperties}>
              3 minutes, no sign-in. PayPal sandbox, so no real money moves.
            </p>
          </div>

          {ex && (
            <div className="relative">
              <figure className="float rise relative p-7" style={{ "--d": "200ms" } as React.CSSProperties}>
                <div className="flex items-baseline justify-between gap-4">
                  <figcaption className="text-sm text-muted">{ex.week}, Gulmohar Residency</figcaption>
                  <span className="chip bg-success-soft text-success">{ex.flats} flats joined</span>
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {ex.prod.title}, {ex.prod.packSize}
                </div>
                <div className="num mt-6 grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-sm text-muted">Approved in PayPal</div>
                    <div className="mono mt-1 text-3xl text-subtle line-through decoration-1">{fmt(ex.b.tiers[0].unitCents)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted">Charged</div>
                    <div className="paid-reveal mono mt-1 text-5xl font-semibold tracking-tight text-brand" style={{ animationDelay: `${300 + ex.b.tiers.filter((t) => (ex.p.keptQty ?? 0) >= t.minQty).length * 450}ms` }}>
                      {fmt(ex.p.finalUnitCents)}
                    </div>
                  </div>
                </div>
                {/* The price ladder: each step down is a tier the building's combined order reached. */}
                <ol className="num mt-6 space-y-2" aria-label="Price per pack as more flats join">
                  {ex.b.tiers.map((t, i) => {
                    const reached = (ex.p.keptQty ?? 0) >= t.minQty;
                    return (
                      <li key={t.minQty} className={`flex items-center justify-between rounded-lg px-4 py-2.5 ${reached ? "ladder-step bg-brand-soft text-brand-dark" : "bg-surface-2 text-muted"}`} style={reached ? { animationDelay: `${300 + i * 450}ms` } : undefined}>
                        <span>{t.minQty}+ packs</span>
                        <span className={`mono ${reached ? "font-semibold" : ""}`}>{fmt(t.unitCents)}</span>
                      </li>
                    );
                  })}
                </ol>
                <p className="mt-5 text-sm text-muted">
                  From {ex.sel.businessName}. Retail is <span className="mono">{fmt(ex.prod.retailRefCents)}</span>.
                </p>
              </figure>
              {facts.ask && (
                <div className="float rise absolute -bottom-10 -left-6 hidden max-w-[19rem] p-4 text-sm lg:block" style={{ "--d": "420ms" } as React.CSSProperties}>
                  <div className="flex items-center gap-2 font-semibold text-info">
                    <span className="h-2 w-2 rounded-full bg-info" /> Society Secretary
                  </div>
                  <p className="mt-1.5 text-muted">{facts.ask.reply}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Proof: numbers from the settled weeks, not claims. */}
      <section aria-label="What the last weeks added up to" className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-5">
        {[
          { v: String(facts.weeks), l: "weeks settled", c: "text-ink" },
          { v: String(facts.flats), l: "flats charged through PayPal", c: "text-brand" },
          { v: fmt(facts.saved), l: `saved against retail${facts.retail ? ` (${Math.round((facts.saved / facts.retail) * 100)}%)` : ""}`, c: "text-accent-ink" },
          { v: String(facts.autoRefunds), l: "refunds the Secretary made itself", c: "text-info" },
          { v: facts.balanced ? "To the cent" : "Check", l: "double-entry ledger balanced", c: "text-success" },
        ].map((f) => (
          <div key={f.l} className="border-l-2 border-line pl-5">
            <div className={`text-4xl font-semibold tracking-tight ${f.c}`}>{f.v}</div>
            <div className="mt-1 text-sm text-muted">{f.l}</div>
          </div>
        ))}
      </section>

      {/* Why it works: three ideas, each with the thing itself. */}
      <section id="why" aria-labelledby="why-title" className="rule scroll-mt-24 pt-12">
        <p className="eyebrow">Why it works</p>
        <h2 id="why-title" className="h-section mt-3 max-w-2xl">
          An AI agent that can negotiate, but can&apos;t overspend.
        </h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <article className="card flex flex-col p-6">
            <span className="chip self-start bg-brand-soft text-brand-dark">PayPal</span>
            <h3 className="mt-4 text-xl">The hold is the budget</h3>
            <p className="mt-2 text-muted">Each flat approves one hold for the most it could cost. No agent can charge more than that, whatever it decides.</p>
            <div className="mt-auto pt-6">
              <div className="flex justify-between text-sm text-muted">
                <span>Held</span>
                <span>Charged</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-track">
                <div className="h-full rounded-full bg-brand" style={{ width: ex ? `${Math.round(((ex.p.finalUnitCents ?? 0) / ex.b.tiers[0].unitCents) * 100)}%` : "85%" }} />
              </div>
              <p className="mt-2 text-sm text-muted">The rest goes back at cutoff.</p>
            </div>
          </article>

          <article className="card flex flex-col p-6">
            <span className="chip self-start bg-info-soft text-info">AI Secretary</span>
            <h3 className="mt-4 text-xl">Money on the table</h3>
            <p className="mt-2 text-muted">It goes back to suppliers with dollars already authorized, and asks for a lower price. Prices can only fall.</p>
            {facts.ask ? (
              <div className="mt-auto space-y-2 pt-6 text-sm">
                <p className="rounded-2xl rounded-bl-sm bg-info-soft p-3">{facts.ask.to}</p>
                <p className="ml-6 rounded-2xl rounded-br-sm border border-line p-3">{facts.ask.reply}</p>
              </div>
            ) : null}
          </article>

          <article className="card flex flex-col p-6">
            <span className="chip self-start bg-success-soft text-success">Trust</span>
            <h3 className="mt-4 text-xl">Trust beats cheap</h3>
            <p className="mt-2 text-muted">Scores come from deliveries and upheld complaints the system saw itself, so the cheapest bid doesn&apos;t win by default.</p>
            <ul className="mt-auto space-y-3 pt-6">
              {facts.trust.map((t) => (
                <li key={t.name}>
                  <div className="flex justify-between text-sm">
                    <span>{t.name}</span>
                    <span className="mono">{t.score}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-track">
                    <div className={`h-full rounded-full ${t.score >= 80 ? "bg-success" : t.score >= 70 ? "bg-accent" : "bg-danger"}`} style={{ width: `${Math.round((t.score / top) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      {/* The week, start to finish. */}
      <section aria-labelledby="week-title" className="rule pt-12">
        <p className="eyebrow">One week</p>
        <h2 id="week-title" className="h-section mt-3">
          From a shopping list to a payout.
        </h2>
        <ol className="hairline-grid mt-10 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Lists", "Type it or snap a photo. Restricted items are blocked.", "bg-ink"],
            ["Bids", "Suppliers bid price ladders on the totals.", "bg-ink"],
            ["Holds", "One PayPal hold per flat, for the maximum.", "bg-brand"],
            ["Cutoff", "PayPal charges the price reached; the rest is released.", "bg-accent"],
            ["Payouts", "Problems refunded, then suppliers paid.", "bg-success"],
          ].map(([t, b, dot], i) => (
            <li key={t} className="p-6">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="mono text-sm text-subtle">0{i + 1}</span>
              </div>
              <h3 className="mt-3 text-lg">{t}</h3>
              <p className="mt-1 text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Look around as anyone. */}
      <section aria-labelledby="try-title" className="rule pt-12">
        <p className="eyebrow">Four views</p>
        <h2 id="try-title" className="h-section mt-3">
          Look around as anyone.
        </h2>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {personas.map((p) => (
            <form key={p.id} action={switchPersona.bind(null, p.id)}>
              <button className="card group flex w-full flex-col items-start p-6 text-left transition-colors hover:border-brand">
                <span className="text-sm text-muted">{ROLE_COPY[p.role].title}</span>
                <span className="mt-1 text-lg font-semibold">{p.name.replace(/ \(.*\)$/, "")}</span>
                <span className="mt-3 text-muted">{ROLE_COPY[p.role].body}</span>
                <span className="mt-5 text-sm font-semibold text-brand">Open view</span>
              </button>
            </form>
          ))}
        </div>
      </section>

    </div>
  );
}
