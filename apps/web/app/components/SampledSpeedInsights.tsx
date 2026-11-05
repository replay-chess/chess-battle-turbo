"use client";

// Vercel Speed Insights at 20% (phase-01 plan 3.2, 9.6; CF F-VER-5): Hobby allows 10,000 events per 30 days
// team-wide. Automated browsers (Playwright, k6 browser, the device suite) set navigator.webdriver; their vitals
// are dropped so test runs never spend the quota. A client component because beforeSend is a function prop.
import { SpeedInsights } from "@vercel/speed-insights/next";

export const SPEED_INSIGHTS_SAMPLE_RATE = 0.2;

type VitalEvent = { type: "vital"; url: string; route?: string };

/** Drops events from automated browsers; everything else goes through unchanged. */
export function dropAutomatedVitals<E extends VitalEvent>(event: E, nav: { webdriver?: boolean } | undefined): E | null {
  return nav?.webdriver ? null : event;
}

export function SampledSpeedInsights() {
  return (
    <SpeedInsights
      sampleRate={SPEED_INSIGHTS_SAMPLE_RATE}
      beforeSend={(event) => dropAutomatedVitals(event, typeof navigator === "undefined" ? undefined : navigator)}
    />
  );
}
