"use client";
import { useMemo, useSyncExternalStore } from "react";
import { AgStudioAiModule, type AgAiHarnessSetup, createAiHarness } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { DashboardData } from "@/lib/dashboard-data";
import { buildStudioData, defaultReport, poolcartStudioTheme } from "./studio-config";
import { claudeAdapter } from "./ai-adapter";

const noSub = () => () => {};

export function Studio({ data, licenseKey, aiEnabled }: { data: DashboardData; licenseKey?: string; aiEnabled: boolean }) {
  const inBrowser = useSyncExternalStore(noSub, () => true, () => false);
  const studioData = useMemo(() => buildStudioData(data), [data]);
  const ai = useMemo<AgAiHarnessSetup | undefined>(
    () =>
      aiEnabled
        ? ({ api }) =>
            createAiHarness(api, {
              adapter: claudeAdapter({ endpoint: "/api/ai/studio" }),
              promptStarters: [
                { label: "Where did residents save most?", prompt: "Which products saved residents the most money vs retail, and by what percentage?" },
                { label: "Why did pools fail?", prompt: "Which pools failed or got no bid, and what do they have in common?" },
                { label: "Add a chart", prompt: "Add a chart of net payouts per seller per week." },
              ],
            })
        : undefined,
    [aiEnabled],
  );
  if (!inBrowser) return <div className="h-[70vh] animate-pulse rounded-xl bg-surface" />;
  return (
    <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
      <AgStudio style={{ height: "100%", width: "100%" }} theme={poolcartStudioTheme} layout={{ widgetBorderEnabled: true }} data={studioData} ai={ai} initialState={defaultReport} mode="view" />
    </AgStudioProvider>
  );
}
