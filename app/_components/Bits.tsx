import type * as s from "@/lib/db/schema";

export function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`card p-4 ${accent ? "!border-brand/30 !bg-brand-soft" : ""}`}>
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent ? "text-brand-dark" : ""}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

const KIND_DOT: Record<string, string> = { phase: "bg-ink", money: "bg-brand", ai: "bg-info", seller: "bg-accent", resident: "bg-[#9b5de5]", issue: "bg-danger", system: "bg-muted" };

export function ActivityFeed({ items }: { items: (typeof s.activity.$inferSelect)[] }) {
  return (
    <div className="card p-4">
      <div className="label mb-3">Live activity</div>
      <ol className="space-y-3">
        {items.map((a) => (
          <li key={a.id} className="flex gap-2 text-xs">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[a.kind]}`} />
            <span>
              <span className="text-muted">{a.actor}, {a.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <br />
              {a.message}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
