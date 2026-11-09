"use client";
// Bryntum Scheduler showing the week. Loaded only in the browser (see WeekTimeline.tsx), read-only.
import { useEffect, useRef } from "react";
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import "./bryntum-dark.css";
import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import type { ScheduleEvent, ScheduleRow } from "@/lib/schedule";

const COLOR: Record<ScheduleEvent["state"], string> = { done: "var(--pc-muted)", now: "var(--pc-brand)", next: "var(--pc-chart-2)" };

export default function WeekTimelineView({ rows, events, startDate, endDate }: { rows: ScheduleRow[]; events: ScheduleEvent[]; startDate: string; endDate: string }) {
  const el = useRef<HTMLDivElement>(null);
  // Pages refresh on a timer; rebuild the chart only when the schedule itself changes.
  const key = JSON.stringify({ events, startDate, endDate });
  useEffect(() => {
    let scheduler: { destroy: () => void } | null = null;
    let cancelled = false;
    import("@bryntum/scheduler").then(({ Scheduler }) => {
      if (cancelled || !el.current) return;
      scheduler = new Scheduler({
        appendTo: el.current,
        readOnly: true,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        viewPreset: "weekAndDay",
        forceFit: true,
        autoAdjustTimeAxis: false,
        rowHeight: 46,
        barMargin: 8,
        eventStyle: "rounded",
        zoomOnMouseWheel: false,
        columns: [{ text: "This week", field: "name", width: 140 }],
        resources: rows,
        events: events.map((e) => ({ ...e, eventColor: COLOR[e.state] })),
        features: {
          cellMenu: false,
          eventMenu: false,
          scheduleMenu: false,
          timeAxisHeaderMenu: false,
          timeRanges: { showCurrentTimeLine: true },
        },
      });
    });
    return () => {
      cancelled = true;
      scheduler?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={el} className="h-[360px]" />;
}
