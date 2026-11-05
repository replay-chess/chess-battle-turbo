// System telemetry (plan §10.1): rate limits, session expiry, payment banner, API error toasts.
//
// Every event is declared in `@repo/analytics` (src/events/system.ts). This module imports TYPES only from it, so
// zod never reaches the browser bundle; the e2e telemetry fixture parses what is captured against the schemas.
//
// `trackSystem()`:
// - mirrors the event into the test sink first (`pushToTelemetrySink`, test builds only; CI has no PostHog key);
// - sends to PostHog only when it is loaded and the page is not a `/dev/**` demo;
// - never throws, and never sends query text, emails or ids other than refs (the schemas allow none).
import type { EventProps, SystemClientEventName } from "@repo/analytics";
import posthog from "posthog-js";
import { ENDPOINT_IDS, endpoints } from "@/lib/api/endpoints";
import { pushToTelemetrySink } from "./shell-events";

export type { SystemClientEventName };
export type SystemEventProps<N extends SystemClientEventName> = EventProps<N>;

function onDevRoute(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === "/dev" || p.startsWith("/dev/");
}

export function trackSystem<N extends SystemClientEventName>(name: N, props: SystemEventProps<N>): void {
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (onDevRoute()) return;
    if (!(posthog as unknown as { __loaded?: boolean }).__loaded) return;
    posthog.capture(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks the UI.
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Property helpers (closed formats; see the regexes in packages/analytics/src/events/system.ts)
// ---------------------------------------------------------------------------------------------------------------

const PATH_TO_ROUTE_ID: ReadonlyMap<string, string> = new Map(
  (Object.keys(endpoints) as (keyof typeof endpoints)[]).map((k) => [endpoints[k], ENDPOINT_IDS[k]]),
);

/** The registry id (`catalog.openings.index`) of an `/api/*` path, or "unknown" when it is not registered. */
export function routeIdForPath(path: string | undefined): string {
  if (!path) return "unknown";
  const bare = path.split("?")[0] ?? path;
  return PATH_TO_ROUTE_ID.get(bare) ?? "unknown";
}

const BUCKET_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;

/** A rate-limit bucket id from an error's `details.bucket`, or "unknown". */
export function bucketOf(details: Record<string, unknown> | undefined): string {
  const b = details?.bucket;
  return typeof b === "string" && BUCKET_RE.test(b) ? b : "unknown";
}

/**
 * Families whose second segment is an id, a ref or a slug: the template keeps the family and replaces the value
 * (`/game/abc123` → `/game/[id]`). Everything else keeps its static segments.
 */
const DYNAMIC_FAMILIES: ReadonlySet<string> = new Set([
  "game",
  "profile",
  "join",
  "join-tournament",
  "position",
  "tournament",
  "legends",
  "openings",
  "analysis",
  "challenge",
  "blog",
]);

const STATIC_SEGMENT = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * The route template of a pathname for analytics (`route_template`): never the concrete URL, so no refs, slugs
 * or query text leave the browser. Unknown dynamic-looking segments become `[id]`.
 */
export function routeTemplateOf(pathname: string): string {
  const parts = pathname.split("?")[0]!.split("#")[0]!.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const out: string[] = [];
  parts.slice(0, 6).forEach((seg, i) => {
    if (i === 1 && DYNAMIC_FAMILIES.has(parts[0]!)) out.push("[id]");
    else out.push(STATIC_SEGMENT.test(seg) ? seg : "[id]");
  });
  return `/${out.join("/")}`;
}
