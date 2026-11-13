// Connected-accounts client telemetry (phase-04 plan §10.1). Closed property sets: providers, contexts, booleans
// and the board state, never a username. The schemas live in @repo/analytics (`src/events/accounts.ts`,
// `accountsClientEvents`); this module imports their TYPES only (zod stays out of the chunk) and the e2e telemetry
// fixture parses what this sends against them. Same rules as trackArchive():
// the e2e sink first, PostHog only when loaded and never on a /dev/** demo route, never throws.
import type { accountsClientEvents } from "@repo/analytics/events/accounts";
import type { z } from "zod";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "@/lib/analytics/shell-events";

type ClientEvents = typeof accountsClientEvents;
export type AccountsClientEventName = keyof ClientEvents;
export type AccountsClientEvents = { [N in AccountsClientEventName]: z.infer<ClientEvents[N]> };

export function trackAccounts<N extends AccountsClientEventName>(name: N, props: AccountsClientEvents[N], opts: { demo?: boolean } = {}): void {
  if (opts.demo) return;
  try {
    pushToTelemetrySink(name, props);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    capturePosthog(name, props);
  } catch {
    // Telemetry never breaks the page.
  }
}
