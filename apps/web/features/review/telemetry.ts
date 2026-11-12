// Review telemetry (phase-03 plan §10.1). Every event is declared in `@repo/analytics` (src/events/review.ts); this
// module imports TYPES only, so zod never reaches the review chunk. Same rules as trackGame(): the e2e telemetry sink
// first, PostHog only when loaded and not on a `/dev/**` demo route, and it never throws. No FEN, SAN, names or refs
// in properties: plies and percentages are bucketed with the registry's helpers' rules (multiples of 10).
import type { EventProps, reviewClientEvents } from "@repo/analytics";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "@/lib/analytics/shell-events";

export type ReviewClientEventName = keyof typeof reviewClientEvents;

export function trackReview<N extends ReviewClientEventName>(name: N, props: EventProps<N>): void {
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    capturePosthog(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks the review.
  }
}

/** A ply or a percentage rounded down to a multiple of 10 (the registry's `ply_bucket` / `accuracy_bucket`). */
export function bucket10(n: number): number {
  return Math.max(0, Math.floor(n / 10) * 10);
}

/** phone | tablet | desktop from the viewport (review_opened.device; shared with the Sentry metrics). */
export { deviceClass } from "@/lib/shell/device-class";
