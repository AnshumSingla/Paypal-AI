"use client";
// When this week's steps happen, and when PayPal holds, charges and pays. The Bryntum bundle loads
// only on the client and only on pages that show the timeline.
import dynamic from "next/dynamic";
import type { weekSchedule } from "@/lib/schedule";

const View = dynamic(() => import("./WeekTimelineView"), { ssr: false, loading: () => <div className="h-[360px] animate-pulse rounded-lg bg-[#f3f3f1]" /> });

export function WeekTimeline({ schedule }: { schedule: ReturnType<typeof weekSchedule> }) {
  return (
    <section className="card p-5" aria-labelledby="week-timeline">
      <h2 id="week-timeline" className="text-lg font-semibold">
        This week, step by step
      </h2>
      <p className="mb-3 text-sm text-muted">Your hold is placed during Confirm and charged once, at cutoff. Problems can be reported for 24 hours after the drop.</p>
      <View {...schedule} />
    </section>
  );
}
