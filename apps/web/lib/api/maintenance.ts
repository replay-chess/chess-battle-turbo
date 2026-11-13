// The maintenance gate of route() (api-design §2 step 3 "Maintenance gate", phase-04 plan §5.8, §7.10; FIX-1): the
// operational switch that takes one area of the API down with `503 maintenance` while the rest of the app keeps
// working. P4's area is `import`: every `/api/accounts/*` and `/api/import/*` route (lookups, links, the Lichess OAuth
// round trip, syncs, unlinks, the import status and retries).
//
//   MAINTENANCE_AFFECTS   comma list of areas that are down, e.g. `import` (unset/empty = nothing is down)
//   MAINTENANCE_RETRY_AT  optional ISO time the area is expected back (`details.retryAt`, `Retry-After`)
//
// The answer is `503 maintenance {details: {affects: [area], retryAt?}}` with `Retry-After`; the client's
// reactToApiError() shows the maintenance notice and never retries it. Webhooks, cron and internal routes have no
// area and are never gated (a provider must be able to deliver). Pair it with the worker's IMPORT_PAUSED to stop the
// import work itself.
import type { EndpointDef } from "@repo/contracts/http/endpoint";
import { ApiError } from "./api-error";

type Env = Readonly<Record<string, string | undefined>>;

/** The areas the gate knows, and the route prefixes each one covers. */
export const MAINTENANCE_AREAS = {
  import: ["/api/accounts", "/api/import"],
} as const satisfies Record<string, readonly string[]>;
export type MaintenanceArea = keyof typeof MAINTENANCE_AREAS;

/** Without MAINTENANCE_RETRY_AT the client is told to look again in five minutes. */
export const MAINTENANCE_DEFAULT_RETRY_SEC = 300;

/** The area a route belongs to (by path), or null; webhook, cron and internal routes have none. */
export function maintenanceAreaOf(spec: Pick<EndpointDef, "path" | "auth">): MaintenanceArea | null {
  if (spec.auth === "webhook" || spec.auth === "cron" || spec.auth === "internal") return null;
  for (const [area, prefixes] of Object.entries(MAINTENANCE_AREAS) as [MaintenanceArea, readonly string[]][]) {
    if (prefixes.some((p) => spec.path === p || spec.path.startsWith(`${p}/`))) return area;
  }
  return null;
}

/** The areas MAINTENANCE_AFFECTS takes down (unknown names are ignored). */
export function affectedAreas(env: Env): Set<MaintenanceArea> {
  const raw = env.MAINTENANCE_AFFECTS?.trim();
  const out = new Set<MaintenanceArea>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (name in MAINTENANCE_AREAS) out.add(name as MaintenanceArea);
  }
  return out;
}

/** The 503 for this route when its area is down, else null. */
export function maintenanceError(spec: Pick<EndpointDef, "path" | "auth">, env: Env, nowMs: number): ApiError | null {
  const area = maintenanceAreaOf(spec);
  if (!area || !affectedAreas(env).has(area)) return null;
  const at = env.MAINTENANCE_RETRY_AT ? Date.parse(env.MAINTENANCE_RETRY_AT) : Number.NaN;
  const retryAfterSec = Number.isFinite(at) && at > nowMs ? Math.min(86_400, Math.ceil((at - nowMs) / 1000)) : MAINTENANCE_DEFAULT_RETRY_SEC;
  return new ApiError("maintenance", {
    retryAfterSec,
    details: { affects: [area], ...(Number.isFinite(at) && at > nowMs ? { retryAt: new Date(at).toISOString() } : {}) },
  });
}
