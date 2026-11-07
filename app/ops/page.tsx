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
import { setSellerStatusAction } from "@/app/actions";
import { ActionButton } from "@/app/_components/ActionButton";
import { ActivityFeed, Kpi } from "@/app/_components/Bits";
import { CycleBar } from "@/app/_components/CycleBar";
import { OpsGrids } from "./OpsGrids";

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
  const [aiStats] = await db.select({ ai: sql<number>`count(*) filter (where ${s.aiDecision.model} <> 'rules')::int`, rules: sql<number>`count(*) filter (where ${s.aiDecision.model} = 'rules')::int` }).from(s.aiDecision);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        {cycle && <CycleBar cycle={cycle} societyName={`${society.name} · Operations`} />}
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Platform revenue" value={fmt(-bal("platform_revenue"))} sub="commission + seller subscriptions" accent />
          <Kpi label="PayPal fees absorbed" value={fmt(bal("platform_expense"))} sub="from capture breakdowns" />
          <Kpi label="Owed to sellers" value={fmt(-bal("seller_payable"))} sub="captured, not yet paid out" />
          <Kpi label="Ledger" value={ledger.balanced ? "Balanced ✓" : "UNBALANCED"} sub={`debits ${fmt(ledger.debit)} = credits ${fmt(ledger.credit)}`} accent={ledger.balanced} />
        </div>

        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h2 className="text-lg font-extrabold">AG Studio analytics</h2>
            <p className="text-sm text-muted">Savings, pool success, PayPal holds vs captures and seller payouts, with a Claude-powered analyst that can build widgets.</p>
          </div>
          <Link href="/ops/dashboard" className="btn btn-primary">
            Open dashboard
          </Link>
        </div>

        <OpsGrids
          ledger={ledgerRows.map((r) => ({ id: r.id, when: r.createdAt.toISOString(), txn: r.txnId, account: r.account, seller: r.sellerId ?? "", debit: r.debitCents, credit: r.creditCents, memo: r.memo }))}
          decisions={decisions.map((d) => ({ id: d.id, when: d.createdAt.toISOString(), agent: d.agent, model: d.model, input: d.inputRef, output: JSON.stringify(d.output).slice(0, 400) }))}
        />

        <section className="card p-5">
          <h2 className="text-lg font-extrabold">Sellers</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1">Business</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Rating</th>
                <th>Strikes</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sellers.map((sel) => (
                <tr key={sel.id}>
                  <td className="py-2">
                    <b>{sel.businessName}</b>
                    <div className="text-xs text-muted">
                      {sel.payoutEmail} · {sel.licenseRef}
                    </div>
                  </td>
                  <td>{sel.status}</td>
                  <td>{sel.plan}</td>
                  <td>{sel.rating / 10}★</td>
                  <td>{sel.strikes}</td>
                  <td>{fmt(sel.balanceCents)}</td>
                  <td className="text-right">
                    {sel.status !== "approved" ? (
                      <ActionButton action={setSellerStatusAction.bind(null, sel.id, "approved")} className="btn btn-primary !py-1 text-xs">
                        Approve
                      </ActionButton>
                    ) : (
                      <ActionButton action={setSellerStatusAction.bind(null, sel.id, "suspended")} className="btn btn-ghost !py-1 text-xs" confirm="Suspend this seller?">
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
          <div className="label">Integrations</div>
          <div>
            PayPal: <b>{payMode() === "sandbox" ? "sandbox REST" : "mock (no keys)"}</b>
          </div>
          <div>
            AI: <b>{aiEnabled() ? aiModel() : "rules fallback"}</b> · {aiStats.ai} AI / {aiStats.rules} rule decisions
          </div>
          <div>
            Webhooks received: <b>{webhooks.length}</b>
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
