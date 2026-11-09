import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { connection } from "next/server";
import { getSession } from "@/lib/session";
import { dashboardData } from "@/lib/dashboard-data";
import { aiEnabled } from "@/lib/ai/llm";
import { ChartColumn } from "lucide-react";
import { IconChip } from "@/app/_components/ui";
import { Studio } from "./Studio";

export const metadata: Metadata = { title: "Analytics" };

export default async function DashboardPage() {
  await connection();
  const { db, user } = await getSession();
  if (!user || user.role !== "operator") redirect("/");
  const data = await dashboardData(db);
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Collective analytics</h1>
          <p className="mt-1 text-muted">
            Built with AG Studio from <span className="num">{data.lines.length}</span> basket lines and <span className="num">{data.payments.length}</span> PayPal payments.
          </p>
        </div>
        <span className={`chip ${aiEnabled() ? "bg-info-soft text-info" : "bg-surface-2 text-muted"}`}>{aiEnabled() ? "Open the AI panel to ask a question" : "The AI analyst is off right now"}</span>
      </header>
      {data.lines.length === 0 && (
        <div className="card flex items-center gap-3 p-4">
          <IconChip icon={<ChartColumn size={18} aria-hidden />} tone="accent" />
          <p className="text-muted">Nothing has been charged yet. Run a week past cutoff and the dashboard fills in.</p>
        </div>
      )}
      <div className="card h-[78vh] overflow-hidden">
        <Studio data={data} licenseKey={process.env.AG_STUDIO_LICENSE} aiEnabled={aiEnabled()} />
      </div>
    </div>
  );
}
