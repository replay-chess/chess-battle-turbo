import { defineEndpoint } from "../endpoint";
import { HomeData } from "../home";
import { Badges } from "../train";

/**
 * Phase-05 plan §7.2 HOME-1 and R8 (ME-2). Handlers: WEB/app/api/home/route.ts, WEB/app/api/me/badges/route.ts
 * (WP-E). Both are client refetches of data the RSC page and the shell seed: `member`, `no-store`, no side effects.
 */
export const homeEndpoints = {
  /** HOME-1. The member landing page. */
  get: defineEndpoint({
    id: "home.get",
    method: "GET",
    path: "/api/home",
    auth: "member",
    class: "R1",
    cache: "no-store",
    response: HomeData,
    summary: "The viewer's Home: continue, Mistake Bank, this week, recent games",
  }),
  /** R8 (ME-2). The shell's badges (also inside /api/me as the optional `badges` field). */
  badges: defineEndpoint({
    id: "me.badges",
    method: "GET",
    path: "/api/me/badges",
    auth: "member",
    class: "R1",
    cache: "no-store",
    response: Badges,
    summary: "The viewer's nav badges (Mistake Bank due count, Train dot)",
  }),
} as const;
