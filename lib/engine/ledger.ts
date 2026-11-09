// Double-entry ledger (Architecture §7). Every money event writes balanced rows under one txn id.
import { sql } from "drizzle-orm";
import type { DB, Tx } from "../db";
import { activity, ledgerEntry } from "../db/schema";
import { newId } from "../util/ids";

type Account = (typeof ledgerEntry.$inferInsert)["account"];
export type Leg = { account: Account; debit?: number; credit?: number; sellerId?: string | null };

export async function post(db: DB | Tx, a: { cycleId: string | null; memo: string; refType: string; refId: string; legs: Leg[] }) {
  const legs = a.legs.filter((l) => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  const dr = legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const cr = legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (dr !== cr) throw new Error(`Unbalanced ledger txn "${a.memo}": debits ${dr} ≠ credits ${cr}`);
  if (!legs.length) return;
  const txnId = newId("txn");
  await db.insert(ledgerEntry).values(
    legs.map((l) => ({ id: newId("led"), cycleId: a.cycleId, txnId, account: l.account, sellerId: l.sellerId ?? null, debitCents: l.debit ?? 0, creditCents: l.credit ?? 0, memo: a.memo, refType: a.refType, refId: a.refId })),
  );
}

export async function ledgerTotals(db: DB) {
  const rows = await db
    .select({ account: ledgerEntry.account, debit: sql<number>`coalesce(sum(${ledgerEntry.debitCents}),0)::int`, credit: sql<number>`coalesce(sum(${ledgerEntry.creditCents}),0)::int` })
    .from(ledgerEntry)
    .groupBy(ledgerEntry.account);
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, debit, credit, balanced: debit === credit };
}

export async function log(db: DB, cycleId: string | null, actor: string, kind: (typeof activity.$inferInsert)["kind"], message: string) {
  await db.insert(activity).values({ id: newId("act"), cycleId, actor, kind, message });
}
