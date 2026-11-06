// Game telemetry (phase-02 plan §10.1). Every event is declared in `@repo/analytics` (src/events/game.ts); this
// module imports TYPES only, so zod never reaches the game chunks. Same rules as trackSystem(): the test sink first,
// PostHog only when loaded and not on a `/dev/**` demo route, never throws.
import type { EventProps, GameClientEventName } from "@repo/analytics";
import posthog from "posthog-js";
import { pushToTelemetrySink } from "./shell-events";

export type { GameClientEventName };

export function trackGame<N extends GameClientEventName>(name: N, props: EventProps<N>): void {
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    if (!(posthog as unknown as { __loaded?: boolean }).__loaded) return;
    posthog.capture(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks the game.
  }
}
