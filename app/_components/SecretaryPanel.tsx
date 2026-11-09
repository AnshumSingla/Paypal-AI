// The Society Secretary on every role's page: what it did this week, and a place to ask it.
import type { DB } from "@/lib/db";
import { SECRETARY, secretaryFeed } from "@/lib/ai/secretary";
import { SecretaryAsk } from "./SecretaryAsk";

const PLACEHOLDER = {
  resident: "How much will I pay for eggs if two more flats join?",
  captain: "Which supplier is most reliable for rice, and why?",
  seller: "How is my trust score calculated?",
  operator: "Which pools are closest to a cheaper tier?",
} as const;

export async function SecretaryPanel({ db, cycleId, role }: { db: DB; cycleId: string; role: keyof typeof PLACEHOLDER }) {
  const feed = await secretaryFeed(db, cycleId, 8);
  return (
    <section className="card p-5" aria-labelledby="secretary-title">
      <h2 id="secretary-title" className="text-base font-semibold">
        Society Secretary
      </h2>
      <p className="mt-1 text-sm text-muted">An AI agent that works for the building. It can refund up to $10 and ask suppliers for better prices; code checks every limit, and PayPal moves the money.</p>
      <div className="mt-4">
        <SecretaryAsk cycleId={cycleId} placeholder={PLACEHOLDER[role]} />
      </div>
      {feed.length > 0 && (
        <ol className="mt-5 space-y-3 border-t border-line pt-4">
          {feed.map((a) => (
            <li key={a.id} className="text-sm leading-snug">
              <span className={a.actor === SECRETARY ? "font-medium text-brand" : "font-medium"}>{a.actor === SECRETARY ? "Secretary" : a.actor}</span>
              <span className="text-muted"> at {a.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <p className="mt-0.5">{a.message}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
