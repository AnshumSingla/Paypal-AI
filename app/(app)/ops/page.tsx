import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { desc, sql } from "drizzle-orm";
import { getSession } from "@/lib/session";
import * as s from "@/lib/db/schema";
import { ledgerTotals } from "@/lib/engine/ledger";
import { activityFeed, societyContext } from "@/lib/queries";
import { payMode } from "@/lib/paypal/gateway";
import { aiEnabled, aiModel } from "@/lib/ai/claude";
import { fmt } from "@/lib/util/money";
import { refreshRetailAction, setSellerStatusAction } from "@/app/actions";
import { channel3Enabled } from "@/lib/channel3";
import { ActionButton } from "@/app/_components/ActionButton";
import { ActivityFeed, Kpi } from "@/app/_components/Bits";
import { CycleBar } from "@/app/_components/CycleBar";
import { OpsGrids } from "./OpsGrids";
import { trustScores } from "@/lib/engine/trust";

/** One readable sentence per AI decision for the audit log, instead of raw JSON. */
function summarizeDecision(agent: string, output: unknown): string {
  const o = (output ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (agent === "society_secretary") return str(o.reply);
  if (agent === "bid_analyst") return str(o.recommendation);
  if (agent === "issue_resolver") return `${str(o.classification)}: ${str(o.rationale)}`;
  if (agent === "pricing_copilot") return str(o.rationale);
  if (agent === "pool_builder") return `Wrote notes for ${Array.isArray(o.pools) ? o.pools.length : 0} pools.`;
  if (agent === "basket_assistant") return `Read ${Array.isArray(o.lines) ? o.lines.length : 0} items from a list.`;
  const first = Object.values(o).find((v) => typeof v === "string");
  return str(first) || JSON.stringify(o).slice(0, 200);
}

export const metadata: Metadata = { title: "Operations" };

export default async function OpsPage() {
  const { db, user } = await getSession();
  if (!user || user.role !== "operator") redirect("/");
  const { society, cycle } = await societyContext(db);
  const [ledger, sellers, decisions, ledgerRows, feed, webhooks] = await Promise.all([
    ledgerTotals(db),
    db.select().from(s.seller),
    db.select().from(s.aiDecision).orderBy(desc(s.aiDecision.createdAt)).limit(200),
    db.select().from(s.ledgerEntry).orderBy(desc(s.ledgerEntry.createdAt)).limit(500),
    activityFeed(db, null, 16),
    db.select().from(s.webhookEvent).orderBy(desc(s.webhookEvent.receivedAt)).limit(20),
  ]);
  const bal = (a: string) => {
    const r = ledger.rows.find((x) => x.account === a);
    return r ? r.debit - r.credit : 0;
  };
  const trust = await trustScores(db, "seller", sellers.map((x) => x.id));
  const [retail] = await db.select({ all: sql<number>`count(*)::int`, live: sql<number>`count(*) filter (where ${s.product.retailSource} = 'channel3')::int` }).from(s.product);
  const [aiStats] = await db.select({ ai: sql<number>`count(*) filter (where ${s.aiDecision.model} <> 'rules')::int`, rules: sql<number>`count(*) filter (where ${s.aiDecision.model} = 'rules')::int` }).from(s.aiDecision);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        {cycle && <CycleBar cycle={cycle} societyName={`${society.name}, operations`} />}
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Platform revenue" value={fmt(-bal("platform_revenue"))} sub="Commission and supplier plans" accent />
          <Kpi label="PayPal fees absorbed" value={fmt(bal("platform_expense"))} sub="From PayPal capture details" />
          <Kpi label="Owed to suppliers" value={fmt(-bal("seller_payable"))} sub="Charged, not yet paid out" />
          <Kpi label="Ledger" value={ledger.balanced ? "Balanced" : "Out of balance"} sub={`Debits ${fmt(ledger.debit)}, credits ${fmt(ledger.credit)}`} accent={ledger.balanced} />
        </div>

        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-lg font-semibold">Analytics</h2>
            <p className="text-sm text-muted">Savings, pool success, PayPal holds against charges, and supplier payouts. Ask the AI analyst a question and it builds the chart.</p>
          </div>
          <Link href="/ops/dashboard" className="btn btn-primary">
            Open dashboard
          </Link>
        </div>

        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-lg font-semibold">Retail prices</h2>
            <p className="text-sm text-muted">
              Residents&apos; savings are measured against retail. {retail.live} of {retail.all} products use today&apos;s price from Channel3; the rest use the catalog price.
            </p>
          </div>
          {channel3Enabled() ? (
            <ActionButton action={refreshRetailAction} className="btn btn-ghost">
              Check with Channel3
            </ActionButton>
          ) : (
            <span className="text-sm text-muted">Add a Channel3 key to check them.</span>
          )}
        </div>

        <OpsGrids
          ledger={ledgerRows.map((r) => ({ id: r.id, when: r.createdAt.toISOString(), txn: r.txnId, account: r.account, seller: r.sellerId ?? "", debit: r.debitCents, credit: r.creditCents, memo: r.memo }))}
          decisions={decisions.map((d) => ({ id: d.id, when: d.createdAt.toISOString(), agent: d.agent, model: d.model, input: d.inputRef, output: summarizeDecision(d.agent, d.output) }))}
        />

        <section className="card p-5">
          <h2 className="text-lg font-semibold">Suppliers</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1">Business</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Trust</th>
                <th>Strikes</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sellers.map((sel) => (
                <tr key={sel.id}>
                  <td className="py-2">
                    <span className="font-medium">{sel.businessName}</span>
                    <div className="text-xs text-muted">
                      {sel.payoutEmail}, licence {sel.licenseRef}
                    </div>
                  </td>
                  <td className="capitalize">{sel.status}</td>
                  <td className="capitalize">{sel.plan}</td>
                  <td className="num">{trust.get(sel.id)}/100</td>
                  <td>{sel.strikes}</td>
                  <td className="num">{fmt(sel.balanceCents)}</td>
                  <td className="text-right">
                    {sel.status !== "approved" ? (
                      <ActionButton action={setSellerStatusAction.bind(null, sel.id, "approved")} className="btn btn-primary !py-1 text-xs">
                        Approve
                      </ActionButton>
                    ) : (
                      <ActionButton action={setSellerStatusAction.bind(null, sel.id, "suspended")} className="btn btn-ghost !py-1 text-xs" confirm="Suspend this supplier? They won't be able to bid.">
                        Suspend
                      </ActionButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <aside className="space-y-4">
        <div className="card space-y-2 p-4 text-sm">
          <h2 className="font-medium">Connections</h2>
          <div>
            PayPal: <b className="font-medium">{payMode() === "sandbox" ? "sandbox REST APIs" : "built-in stand-in (no keys)"}</b>
          </div>
          <div>
            AI: <b className="font-medium">{aiEnabled() ? aiModel() : "rule-based fallbacks"}</b>. {aiStats.ai} AI and {aiStats.rules} rule-based decisions so far.
          </div>
          <div>
            PayPal webhooks received: <b className="font-medium">{webhooks.length}</b>
            {webhooks.slice(0, 5).map((w) => (
              <div key={w.paypalEventId} className="text-xs text-muted">
                {w.type}
              </div>
            ))}
          </div>
        </div>
        <ActivityFeed items={feed} />
      </aside>
    </div>
  );
}
