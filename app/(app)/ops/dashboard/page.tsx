import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getSession } from "@/lib/session";
import { dashboardData } from "@/lib/dashboard-data";
import { aiEnabled } from "@/lib/ai/claude";
import { Studio } from "./Studio";

export const metadata: Metadata = { title: "Analytics" };

export default async function DashboardPage() {
  await connection();
  const { db, user } = await getSession();
  if (!user || user.role !== "operator") redirect("/");
  const data = await dashboardData(db);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Collective analytics</h1>
        <span className="text-xs text-muted">
          Built with AG Studio from {data.lines.length} basket lines and {data.payments.length} PayPal payments. {aiEnabled() ? "Open the AI panel to ask a question." : "The AI analyst is off right now."}
        </span>
      </div>
      {data.lines.length === 0 && <p className="card p-4 text-sm text-muted">Nothing has been charged yet. Run a week past cutoff and the dashboard fills in.</p>}
      <div className="card h-[78vh] overflow-hidden">
        <Studio data={data} licenseKey={process.env.AG_STUDIO_LICENSE} aiEnabled={aiEnabled()} />
      </div>
    </div>
  );
}
