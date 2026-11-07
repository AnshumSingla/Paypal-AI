import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getSession } from "@/lib/session";
import { dashboardData } from "@/lib/dashboard-data";
import { aiEnabled } from "@/lib/ai/claude";
import { Studio } from "./Studio";

export const metadata: Metadata = { title: "AG Studio dashboard" };

export default async function DashboardPage() {
  await connection();
  const { db, user } = await getSession();
  if (!user || user.role !== "operator") redirect("/");
  const data = await dashboardData(db);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-extrabold">PoolCart analytics</h1>
        <span className="text-xs text-muted">
          AG Studio · {data.lines.length} basket lines · {data.payments.length} PayPal payments · {aiEnabled() ? "AI analyst: Claude (open the AI panel)" : "add ANTHROPIC_API_KEY to enable the AI analyst"}
        </span>
      </div>
      {data.lines.length === 0 && <p className="card p-4 text-sm text-muted">No settled data yet. Run a cycle past cutoff (demo clock) and the dashboard fills in.</p>}
      <div className="card h-[78vh] overflow-hidden">
        <Studio data={data} licenseKey={process.env.AG_STUDIO_LICENSE} aiEnabled={aiEnabled()} />
      </div>
    </div>
  );
}
