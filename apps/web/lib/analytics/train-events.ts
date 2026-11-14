// Train, Mistake Bank, puzzle and Home telemetry (phase-05 plan §10.1). Every event is declared in `@repo/analytics`
// (src/events/train.ts, src/events/home.ts); this module imports TYPES only, so zod never reaches the train chunks. The
// rules of trackGame(): the e2e telemetry sink first, PostHog only when loaded and not on a `/dev/**` demo route, never
// throws. Properties are closed: counts, states, theme keys and grades; never a FEN, a move, a name or a ref (the e2e
// PII guard fails a spec on any of them, and P5 specs forbid every solution SAN they play).
import type { EventProps, TrainClientEventName } from "@repo/analytics";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "./shell-events";

export type { TrainClientEventName };

export function trackTrain<N extends TrainClientEventName>(name: N, props: EventProps<N>): void {
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    capturePosthog(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks training.
  }
}

/** The grade a member picked differs from the suggestion (`train_item_graded.overridden`, D-10). */
export function isOverridden(grade: string, suggested: string): boolean {
  return grade !== suggested;
}

/** Whole days until a card's next review (`train_item_graded.interval_days`), from the preview's `days`. */
export function intervalDays(days: number): number {
  return Math.max(0, Math.round(days * 100) / 100);
}
