// Home and badge queries (phase-05 plan §5.1): HOME-1 `GET /api/home` and R8 `GET /api/me/badges`. Keys from `qk`
// only; the schema check is written at the call site so zod stays out of production chunks (AP-12).
//
//   qk.home()     30 s, focus refetch; seeded by /home (prefetchQuery, awaited); socket events patch counts and
//                 invalidate through invalidateThrottled(qk.home(), 30_000) (WP-H)
//   qk.badges()   60 s, focus refetch only: no interval poll, even with the socket down (api-perf AP-08 item 4)
import { queryOptions } from "@tanstack/react-query";
import type { HomeData } from "@repo/contracts/http/home";
import { HomeData as HomeDataSchema } from "@repo/contracts/http/home";
import type { Badges } from "@repo/contracts/http/train";
import { Badges as BadgesSchema } from "@repo/contracts/http/train";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

export const HOME_STALE_MS = 30_000;
export const BADGES_STALE_MS = 60_000;

export async function fetchHome(signal?: AbortSignal): Promise<HomeData> {
  const schema = process.env.NODE_ENV === "production" ? undefined : HomeDataSchema;
  const { data } = await api(endpoints.home, { schema, signal });
  return data as HomeData;
}

export async function fetchBadges(signal?: AbortSignal): Promise<Badges> {
  const schema = process.env.NODE_ENV === "production" ? undefined : BadgesSchema;
  const { data } = await api(endpoints.meBadges, { schema, signal });
  return data as Badges;
}

export function homeQuery() {
  return queryOptions({
    queryKey: qk.home(),
    queryFn: ({ signal }): Promise<HomeData> => fetchHome(signal),
    staleTime: HOME_STALE_MS,
    refetchOnWindowFocus: true,
    meta: { object: "your home page" },
  });
}

export function badgesQuery() {
  return queryOptions({
    queryKey: qk.badges(),
    queryFn: ({ signal }): Promise<Badges> => fetchBadges(signal),
    staleTime: BADGES_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: false,
    meta: { object: "your badges" },
  });
}
