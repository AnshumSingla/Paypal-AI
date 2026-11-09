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
import { ActivityFeed } from "@/app/_components/Bits";
import { CycleBar } from "@/app/_components/CycleBar";
import { Empty, IconChip, Panel, Stat, StatRow } from "@/app/_components/ui";
import { Bot, ChartColumn, CreditCard, Landmark, Receipt, Scale, Store, Truck, Webhook } from "lucide-react";
import { OpsGrids } from "./OpsGrids";
import { trustScores } from "@/lib/engine/trust";

const STATUS_CHIP: Record<string, string> = {
  approved: "bg-success-soft text-success",
  pending: "bg-accent-soft text-accent-ink",
  suspended: "bg-danger-soft text-danger",
};

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

  const livePct = retail.all ? Math.round((retail.live / retail.all) * 100) : 0;

  return (
    <div className="space-y-6">
      {cycle ? <CycleBar cycle={cycle} societyName={`${society.name}, operations`} /> : <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>}

      <div data-tour="stats">
      <StatRow>
        <Stat icon={<Landmark size={20} aria-hidden />} tone="brand" title="Platform revenue" value={fmt(-bal("platform_revenue"))} sentence="from commission and plans" href="/ops/dashboard" action="Open analytics" />
        <Stat icon={<Receipt size={20} aria-hidden />} tone="info" title="PayPal fees" value={fmt(bal("platform_expense"))} sentence="absorbed on captures" href="#ledger" action="View ledger" />
        <Stat icon={<Truck size={20} aria-hidden />} tone="accent" title="Owed to suppliers" value={fmt(-bal("seller_payable"))} sentence="charged, not paid out" href="#suppliers" action="Review suppliers" />
        <Stat
          icon={<Scale size={20} aria-hidden />}
          tone={ledger.balanced ? "success" : "danger"}
          title="Ledger"
          value={ledger.balanced ? "Balanced" : "Out of balance"}
          sentence={`debits ${fmt(ledger.debit)}, credits ${fmt(ledger.credit)}`}
          href="#ledger"
          action="Open ledger"
        />
      </StatRow>
      </div>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title="Analytics"
              description="Savings, pools, holds against charges, payouts."
              aside={
                <Link href="/ops/dashboard" className="btn btn-primary">
                  Open dashboard
                </Link>
              }
            >
              <div className="flex items-center gap-3">
                <IconChip icon={<ChartColumn size={18} aria-hidden />} tone="brand" />
                <p className="text-muted">Ask the AI analyst a question and it builds the chart.</p>
              </div>
            </Panel>

            <Panel
              title="Retail prices"
              description="Residents' savings are measured against retail."
              aside={
                channel3Enabled() ? (
                  <ActionButton action={refreshRetailAction} className="btn btn-ghost">
                    Check with Channel3
                  </ActionButton>
                ) : null
              }
            >
              <p>
                <span className="num text-2xl font-semibold tracking-tight">
                  {retail.live} of {retail.all}
                </span>
                <span className="ml-2 text-muted">products use today&apos;s Channel3 price</span>
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
                <div className="h-full rounded-full bg-brand" style={{ width: `${livePct}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">{channel3Enabled() ? "The rest use the catalog price." : "The rest use the catalog price. Add a Channel3 key to check them."}</p>
            </Panel>
          </div>

          <OpsGrids
            ledger={ledgerRows.map((r) => ({ id: r.id, when: r.createdAt.toISOString(), txn: r.txnId, account: r.account, seller: r.sellerId ?? "", debit: r.debitCents, credit: r.creditCents, memo: r.memo }))}
            decisions={decisions.map((d) => ({ id: d.id, when: d.createdAt.toISOString(), agent: d.agent, model: d.model, input: d.inputRef, output: summarizeDecision(d.agent, d.output) }))}
          />
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel id="suppliers" title="Suppliers" description="Approve to let them bid; suspend to stop them." flush>
            {sellers.length === 0 ? (
              <Empty icon={<Store size={20} aria-hidden />} title="No suppliers yet" />
            ) : (
              <ul className="divide-y divide-line">
                {sellers.map((sel) => (
                  <li key={sel.id} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{sel.businessName}</span>
                          <span className={`chip capitalize ${STATUS_CHIP[sel.status]}`}>{sel.status}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted">
                          {sel.payoutEmail}, licence <span className="mono">{sel.licenseRef}</span>
                        </div>
                      </div>
                      {sel.status !== "approved" ? (
                        <ActionButton action={setSellerStatusAction.bind(null, sel.id, "approved")} className="btn btn-primary !min-h-0 !py-1 text-sm">
                          Approve
                        </ActionButton>
                      ) : (
                        <ActionButton action={setSellerStatusAction.bind(null, sel.id, "suspended")} className="btn btn-ghost !min-h-0 !py-1 text-sm" confirm="Suspend this supplier? They won't be able to bid.">
                          Suspend
                        </ActionButton>
                      )}
                    </div>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted">Plan</dt>
                        <dd className="capitalize">{sel.plan}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Trust</dt>
                        <dd className="num">{trust.get(sel.id)}/100</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Strikes</dt>
                        <dd className={`num ${sel.strikes > 0 ? "text-danger" : ""}`}>{sel.strikes}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Balance</dt>
                        <dd className="num">{fmt(sel.balanceCents)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Connections" description="What this deployment is talking to." flush>
            <ul className="divide-y divide-line">
              <li className="flex items-center gap-3 px-6 py-4">
                <IconChip icon={<CreditCard size={18} aria-hidden />} tone="brand" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">PayPal</div>
                  <div className="text-xs text-muted">{payMode() === "sandbox" ? "Sandbox REST APIs" : "Built-in stand-in (no keys)"}</div>
                </div>
                <span className={`chip ${payMode() === "sandbox" ? "bg-success-soft text-success" : "bg-accent-soft text-accent-ink"}`}>{payMode() === "sandbox" ? "Sandbox" : "Stand-in"}</span>
              </li>
              <li className="flex items-center gap-3 px-6 py-4">
                <IconChip icon={<Bot size={18} aria-hidden />} tone="info" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">AI</div>
                  <div className="text-xs text-muted">
                    {aiEnabled() ? <span className="mono">{aiModel()}</span> : "Rule-based fallbacks"}. <span className="num">{aiStats.ai}</span> AI and <span className="num">{aiStats.rules}</span> rule-based decisions so far.
                  </div>
                </div>
                <span className={`chip ${aiEnabled() ? "bg-info-soft text-info" : "bg-accent-soft text-accent-ink"}`}>{aiEnabled() ? "On" : "Rules"}</span>
              </li>
              <li className="px-6 py-4">
                <div className="flex items-center gap-3">
                  <IconChip icon={<Webhook size={18} aria-hidden />} tone="brand" />
                  <div className="min-w-0 flex-1 font-semibold">PayPal webhooks received</div>
                  <span className="num text-lg font-semibold">{webhooks.length}</span>
                </div>
                {webhooks.length > 0 ? (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-brand">Latest events</summary>
                    <ul className="mt-2 space-y-1">
                      {webhooks.slice(0, 5).map((w) => (
                        <li key={w.paypalEventId} className="mono truncate text-xs text-muted">
                          {w.type}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            </ul>
          </Panel>

          <ActivityFeed items={feed} />
        </aside>
      </div>
    </div>
  );
}
