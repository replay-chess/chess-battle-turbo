// Shell telemetry (SPEC 3.10). Every shell event goes through trackShell, which
// no-ops when PostHog isn't loaded (keys blanked locally and in CI) or on demo
// routes. Query text is never sent: the palette sends only its length.
//
// The event shapes come from the one registry, @repo/analytics (plan §10.1,
// packages/analytics/src/events/shell.ts). The import is type-only, so zod
// never reaches the browser bundle; the e2e telemetry fixture parses what is
// captured against the same schemas.
import type { EventProps, ShellEventName } from "@repo/analytics";
import posthog from "posthog-js";
import type { DestinationKey } from "../shell/types";
import { RAIL_MQ, TABBAR_MQ } from "../layout/media-queries";
import { isTestBuild } from "../env";

/** One shell event: `{ name, ...props }`, with the props exactly as the registry declares them. */
export type ShellEvent = { [N in ShellEventName]: { name: N } & EventProps<N> }[ShellEventName];

export type NavSurface = EventProps<"shell_nav_click">["surface"];
export type AccountActionId = EventProps<"shell_account_action">["action"];

// The registry mirrors DestinationKey (lib/shell/types.ts); a drift fails check-types here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const destinationKeysMatch: Same<EventProps<"shell_nav_click">["dest"], DestinationKey> = true;
void destinationKeysMatch;

type SinkEntry = { event: string; props: Record<string, unknown>; ts: number };

/**
 * Test builds only (`NEXT_PUBLIC_TELEMETRY_SINK=1` and `NEXT_PUBLIC_APP_ENV=test`): mirror a client event into
 * `window.__rcTelemetry`, which the e2e telemetry fixture reads. Runs before the PostHog check because CI has no
 * PostHog key. The registry entry `NEXT_PUBLIC_TELEMETRY_SINK` (lib/test-hooks/registry.ts) proves it is absent
 * on production builds. Exported for the system events (1B·F8).
 */
export function pushToTelemetrySink(event: string, props: Record<string, unknown>): void {
  if (process.env.NEXT_PUBLIC_TELEMETRY_SINK !== "1" || !isTestBuild()) return;
  if (typeof window === "undefined") return;
  const w = window as unknown as { __rcTelemetry?: SinkEntry[] };
  (w.__rcTelemetry ??= []).push({ event, props, ts: Date.now() });
}

export function trackShell(event: ShellEvent, opts: { demo?: boolean } = {}): void {
  if (opts.demo) return;
  try {
    const { name, ...props } = event;
    pushToTelemetrySink(name, props);
    if (!(posthog as unknown as { __loaded?: boolean }).__loaded) return;
    posthog.capture(name, props);
  } catch {
    // Telemetry never breaks navigation.
  }
}

/** The nav surface at click time, from the same media queries the CSS uses. */
export function navSurface(): "sidebar" | "rail" | "tabbar" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "sidebar";
  if (window.matchMedia(TABBAR_MQ).matches) return "tabbar";
  if (window.matchMedia(RAIL_MQ).matches) return "rail";
  return "sidebar";
}
