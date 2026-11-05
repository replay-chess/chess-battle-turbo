// Shell telemetry (SPEC 3.10). Every shell event goes through trackShell, which
// no-ops when PostHog isn't loaded (keys blanked locally and in CI) or on demo
// routes. Query text is never sent: the palette sends only its length.
import posthog from "posthog-js";
import type { DestinationKey } from "../shell/types";
import { RAIL_MQ, TABBAR_MQ } from "../layout/media-queries";
import { isTestBuild } from "../env";

export type NavSurface = "sidebar" | "rail" | "tabbar" | "subnav" | "back" | "palette" | "chord";
export type AccountActionId =
  | "membership"
  | "billing"
  | "account"
  | "theme"
  | "install"
  | "admin"
  | "help"
  | "privacy"
  | "terms"
  | "signout";

export type ShellEvent =
  | { name: "shell_nav_click"; dest: DestinationKey; surface: NavSurface }
  | { name: "shell_palette_opened"; via: "shortcut" | "slash" | "button" }
  | { name: "shell_palette_command"; id: string; group: "goto" | "actions" | "legends"; queryLength: number }
  | { name: "shell_shortcuts_opened"; via: "key" | "palette" }
  | { name: "shell_shortcuts_toggled"; enabled: boolean }
  | { name: "shell_account_action"; action: AccountActionId };

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
