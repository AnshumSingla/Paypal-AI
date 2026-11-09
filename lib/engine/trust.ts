// Supplier trust and resident reliability, computed from verified events (trust_event), never
// from free-text reviews. One formula for both sides:
//   score = weighted mean of event scores, with a neutral prior so a few events can't dominate
//   (Bayesian smoothing) and a 90-day half-life so recent behaviour counts more.
import { and, eq, inArray } from "drizzle-orm";
import type { DB, Tx } from "../db";
import * as s from "../db/schema";
import { newId } from "../util/ids";

export const TRUST_PRIOR = 75; // where a new supplier or resident starts
const PRIOR_WEIGHT = 20; // how many events' worth of evidence the prior is worth
const HALF_LIFE_MS = 90 * 24 * 3600 * 1000;

export type TrustInput = { score: number; weight: number; voided: boolean; createdAt: Date };

/** Pure: 0-100, rounded. */
export function trustScore(events: TrustInput[], now = Date.now()): number {
  let num = TRUST_PRIOR * PRIOR_WEIGHT;
  let den = PRIOR_WEIGHT;
  for (const e of events) {
    if (e.voided) continue;
    const w = e.weight * 0.5 ** (Math.max(0, now - e.createdAt.getTime()) / HALF_LIFE_MS);
    num += e.score * w;
    den += w;
  }
  return Math.round(num / den);
}

type Kind = (typeof s.trustEvent.$inferInsert)["kind"];
const SCORE: Record<Kind, number> = { delivered: 100, issue_upheld: 0, commitment_kept: 100, payment_failed: 0, claim_rejected: 0 };
// An upheld complaint costs a household a meal; it counts as much as three good deliveries.
const DEFAULT_WEIGHT: Record<Kind, number> = { delivered: 1, issue_upheld: 3, commitment_kept: 1, payment_failed: 1, claim_rejected: 1 };

export async function recordTrust(db: DB | Tx, e: { subjectType: "seller" | "household"; subjectId: string; cycleId: string | null; kind: Kind; weight?: number; refId?: string; note?: string; createdAt?: Date }) {
  await db.insert(s.trustEvent).values({ id: newId("tev"), subjectType: e.subjectType, subjectId: e.subjectId, cycleId: e.cycleId, kind: e.kind, score: SCORE[e.kind], weight: e.weight ?? DEFAULT_WEIGHT[e.kind], refId: e.refId ?? null, note: e.note ?? null, ...(e.createdAt ? { createdAt: e.createdAt } : {}) });
}

/** Scores for many subjects at once; subjects with no events get the prior. */
export async function trustScores(db: DB, subjectType: "seller" | "household", ids: string[]): Promise<Map<string, number>> {
  const out = new Map(ids.map((id) => [id, TRUST_PRIOR]));
  if (!ids.length) return out;
  const rows = await db.select().from(s.trustEvent).where(and(eq(s.trustEvent.subjectType, subjectType), inArray(s.trustEvent.subjectId, ids)));
  for (const id of ids) out.set(id, trustScore(rows.filter((r) => r.subjectId === id)));
  return out;
}

/** Appeal: a captain or operator voids an event that turned out to be wrong. */
export async function voidTrustEvent(db: DB, eventId: string, actor: string) {
  await db.update(s.trustEvent).set({ voided: true, voidedBy: actor }).where(eq(s.trustEvent.id, eventId));
}
