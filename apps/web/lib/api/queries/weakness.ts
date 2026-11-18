// Weakness Profile query (phase-06 plan §5.1, §5.3, §5.4, §9.2; AP-08, AP-12, AP-20, AP-21). Key `qk.train.weakness()`,
// seeded by the `/train/weakness` RSC (`getWeakness`, the same payload), so the first paint makes no /api request.
//
//   staleTime   10 min, 0 while the profile is building or updating (`computing`, or `updating` set)
//   focus       refetches only when stale; TR-5's strong ETag makes every refetch a 304 when nothing moved
//               (`private, no-cache`: the browser revalidates with If-None-Match, no client code)
//   socket      `weakness:progress` patches the cache, `weakness:ready` invalidates it (lib/realtime/handlers/weakness.ts)
//   fallback    only while building or updating AND the socket is not live AND the tab is visible: after 5 s,
//               3 s × 20, then every 10 s, never after 15 min (`fallbackInterval` keeps its state per Query, so a
//               re-created options object does not restart it; a new building episode does)
//   gcTime      5 min
//
// Responses are checked against the zod schema in dev and test only (`NODE_ENV === "production" ? undefined : …` at the
// call site, so the minifier drops the schema and zod from the production chunks).
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import type { RecomputeBody, RecomputeResponse, WeaknessPayload } from "@repo/contracts/http/weakness";
import { RecomputeResponse as RecomputeResponseSchema, WeaknessPayload as WeaknessPayloadSchema } from "@repo/contracts/http/weakness";
import { fallbackInterval, type FallbackSchedule, type PollQuery } from "@/lib/realtime/fallback-interval";
import { useConnection } from "@/lib/realtime/useConnection";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

/** A settled profile stays fresh this long (§9.2). */
export const WEAKNESS_STALE_MS = 10 * 60_000;
/** Unused cache entries are dropped after 5 min. */
export const WEAKNESS_GC_MS = 5 * 60_000;

/** §5.1: the socket-down fallback poll: 5 s grace, 3 s × 20, then 10 s, stopping 15 min after it started. */
export const WEAKNESS_FALLBACK: FallbackSchedule = {
  delayMs: 5_000,
  stepsMs: [...Array<number>(20).fill(3_000), 10_000],
  stopAfterMs: 15 * 60_000,
};

/** The profile is moving: a first build (`computing`) or a recompute behind a READY profile (`updating`). */
export function isWeaknessLive(d: Pick<WeaknessPayload, "status" | "updating"> | undefined): boolean {
  return !!d && (d.status === "computing" || d.updating !== null);
}

/** 0 while live (every reader revalidates), else 10 min. */
export function weaknessStaleTime(d: Pick<WeaknessPayload, "status" | "updating"> | undefined): number {
  return isWeaknessLive(d) ? 0 : WEAKNESS_STALE_MS;
}

/**
 * The `refetchInterval` body: polls only while the profile is live and the socket is not; `false` otherwise (which
 * also resets the schedule, so the next outage or the next build starts at the first step).
 */
export function weaknessPollInterval(
  query: PollQuery & { state: { data?: Pick<WeaknessPayload, "status" | "updating"> } },
  socketLive: boolean,
  now: number = Date.now(),
): number | false {
  return fallbackInterval(query, WEAKNESS_FALLBACK, !socketLive && isWeaknessLive(query.state.data), now);
}

export async function fetchWeakness(signal?: AbortSignal): Promise<WeaknessPayload> {
  const schema = process.env.NODE_ENV === "production" ? undefined : WeaknessPayloadSchema;
  const { data } = await api(endpoints.trainWeakness, { schema, signal });
  return data as WeaknessPayload;
}

/** TR-5. `socketLive`: the realtime connection is live (no fallback poll then). Hidden tabs never poll. */
export function weaknessQuery(o: { socketLive?: boolean } = {}) {
  const socketLive = o.socketLive ?? false;
  return queryOptions({
    queryKey: qk.train.weakness(),
    queryFn: ({ signal }): Promise<WeaknessPayload> => fetchWeakness(signal),
    staleTime: (query) => weaknessStaleTime(query.state.data as WeaknessPayload | undefined),
    gcTime: WEAKNESS_GC_MS,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => weaknessPollInterval(query, socketLive),
    refetchIntervalInBackground: false,
    meta: { object: "your weakness profile" },
  });
}

/** The profile screen's read: the RSC-seeded cache (never suspends on first paint), polling only without a socket. */
export function useWeaknessQuery() {
  const conn = useConnection();
  return useSuspenseQuery(weaknessQuery({ socketLive: conn === "live" }));
}

/** TR-12: Retry, "Include bullet games", the orphaned auto-build. 429 carries `retryAfterSec`. */
export async function postWeaknessRecompute(body: RecomputeBody = {}, signal?: AbortSignal): Promise<RecomputeResponse> {
  const schema = process.env.NODE_ENV === "production" ? undefined : RecomputeResponseSchema;
  const { data } = await api(endpoints.trainWeaknessRecompute, { method: "POST", body, schema, signal });
  return data as RecomputeResponse;
}

/** TR-13: the profile version the member has seen (sent once per version after mount; survives a page leave). */
export async function postWeaknessSeen(version: number): Promise<void> {
  await api(endpoints.trainWeaknessSeen, { method: "POST", body: { version }, keepalive: true });
}
