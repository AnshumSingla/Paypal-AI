import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { switchPersona } from "./actions";
import { Logo } from "./_components/Header";

const ROLE_COPY: Record<string, { title: string; body: string }> = {
  resident: { title: "Resident", body: "Snap your grocery list, confirm one PayPal hold, pay only the price your building unlocks." },
  captain: { title: "Captain", body: "See the building's pooled demand, compare AI-ranked seller bids, confirm the drop." },
  seller: { title: "Seller", body: "Bid on pre-committed bulk demand with an AI pricing copilot, get paid by PayPal Payouts." },
  operator: { title: "Operator", body: "Ledger, payouts, seller approvals and an AG Studio dashboard with an AI analyst." },
};

export default async function Home() {
  const db = await getDb();
  const personas = await db.select().from(s.appUser).where(eq(s.appUser.isPersona, true));
  return (
    <div className="space-y-10">
      <section className="card relative overflow-hidden px-6 py-10 sm:px-10">
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <span className="chip bg-brand-soft text-brand-dark">PayPal + AI · agentic group buying</span>
          </div>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Your building buys groceries together. Everyone pays wholesale.</h1>
          <p className="text-lg text-muted">
            40 households buy the same eggs, rice and oil every week, separately, at retail. PoolCart&apos;s AI turns their lists into pooled orders, local sellers bid volume prices, and PayPal
            <b className="text-ink"> holds the highest price, then captures only the price the group unlocked</b>.
          </p>
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ["1 · Pool", "Claude reads lists (even handwritten photos), matches products via Channel3 and builds one pool per product."],
            ["2 · Compete", "Sellers bid tiered prices. The Bid Analyst ranks bids and explains the trade-offs to the captain."],
            ["3 · Pay fair", "One PayPal authorization per resident; partial final capture at cutoff, refunds for issues, Payouts to sellers."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl bg-canvas p-4">
              <div className="font-bold">{t}</div>
              <p className="mt-1 text-sm text-muted">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-extrabold">Try it as…</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {personas.map((p) => (
            <form key={p.id} action={switchPersona.bind(null, p.id)} className="card flex flex-col p-5">
              <div className="label">{ROLE_COPY[p.role].title}</div>
              <div className="mt-1 text-lg font-bold">{p.name}</div>
              <p className="mt-2 flex-1 text-sm text-muted">{ROLE_COPY[p.role].body}</p>
              <button className="btn btn-primary mt-4">Continue as {ROLE_COPY[p.role].title.toLowerCase()}</button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
