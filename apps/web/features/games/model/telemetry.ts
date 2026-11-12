// Archive and How-we-grade telemetry (phase-03 plan §10.1). The event shapes live in @repo/analytics
// (src/events/review.ts); this module imports TYPES only, so zod never reaches the page chunks. Same rules as
// trackGame(): the e2e sink first, PostHog only when loaded and never on a /dev/** demo route, never throws.
import type { EventProps, ReviewClientEventName } from "@repo/analytics";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "@/lib/analytics/shell-events";
import { activeDimensions, type GamesFilter } from "./filter";

type ArchiveEventName = Extract<
  ReviewClientEventName,
  "games_archive_viewed" | "games_archive_filtered" | "games_archive_game_opened" | "how_we_grade_viewed"
>;

export type CountBucket = EventProps<"games_archive_viewed">["count_bucket"];

/** The registry's COUNT_BUCKETS ("0", "1", "2-9", "10-29", "30-99", "100+"); the return type pins the spelling. */
export function countBucket(n: number): CountBucket {
  if (n <= 0) return "0";
  if (n === 1) return "1";
  if (n < 10) return "2-9";
  if (n < 30) return "10-29";
  if (n < 100) return "30-99";
  return "100+";
}

export function trackArchive<N extends ArchiveEventName>(name: N, props: EventProps<N>): void {
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    capturePosthog(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks the page.
  }
}

/** `games_archive_filtered` props for an applied filter and its result count. Never the search text. */
export function filteredProps(filter: GamesFilter, results: number): EventProps<"games_archive_filtered"> {
  return {
    result: [...(filter.result ?? [])],
    tc: [...(filter.tc ?? [])],
    moments: Boolean(filter.moments),
    q_len: Math.min(filter.q?.length ?? 0, 40),
    results_bucket: countBucket(results),
  };
}

export function viewedProps(filter: GamesFilter, total: number): EventProps<"games_archive_viewed"> {
  return { count_bucket: countBucket(total), filters_active: activeDimensions(filter) };
}
