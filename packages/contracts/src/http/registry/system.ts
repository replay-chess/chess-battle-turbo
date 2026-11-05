import { defineEndpoint } from "../endpoint";
import { CronDailyData, HealthcheckText, HealthData, HealthQuery } from "../system";

export const systemEndpoints = {
  /** A1. Rate-limited only when deep=1 (the wrapper's rateLimitWhen). */
  health: defineEndpoint({
    id: "health.get",
    method: "GET",
    path: "/api/health",
    auth: "public",
    class: "R1",
    cache: "no-store",
    query: HealthQuery,
    response: HealthData,
    rateLimit: { bucket: "health-deep", limit: 6, windowSec: 60, by: "ip" },
    errors: ["unavailable"],
    summary: "Liveness and build id; deep=1 also pings the database",
  }),
  /** A2. Alias kept for existing monitors; deleted in P11. */
  healthcheck: defineEndpoint({
    id: "healthcheck.get",
    method: "GET",
    path: "/api/healthcheck",
    auth: "public",
    class: "R1",
    cache: "no-store",
    response: HealthcheckText,
    responseFormat: "text",
    deprecated: true,
    summary: "Plain-text liveness (legacy alias of /api/health)",
  }),
  /** A9. Vercel cron, daily. */
  cronDaily: defineEndpoint({
    id: "cron.daily",
    method: "GET",
    path: "/api/cron/daily",
    auth: "cron",
    class: "X",
    cache: "no-store",
    sideEffects: ["cron"],
    response: CronDailyData,
    summary: "Runs the ordered daily task list",
  }),
  /** A18. 204 with Clear-Site-Data: "cache"; called by signOutEverywhere() before clerk.signOut(). */
  sessionClear: defineEndpoint({
    id: "session.clear",
    method: "POST",
    path: "/api/session/clear",
    auth: "optional",
    class: "W1",
    cache: "no-store",
    status: 204,
    summary: "Clears the browser HTTP cache for this origin on sign-out",
  }),
} as const;
