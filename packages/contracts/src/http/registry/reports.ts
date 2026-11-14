import { defineEndpoint } from "../endpoint";
import { REPORT_BURST_LIMIT, REPORT_MAX_BODY_BYTES, ReportBody, ReportResult } from "../reports";

/**
 * Phase-05 plan §7.2 W7 (api SYS-6). Handler: WEB/app/api/reports/route.ts (WP-E); P10 adds the `user` / `game`
 * branches to the same handler. `report-burst` 5 / 60 s is the route limiter; the 20-a-day limit is durable and
 * counted by the handler (REPORT_DAILY in ../reports.ts). 201 new, 200 `duplicate: true` inside 24 h; 404 when the
 * target is not visible to the viewer. `Idempotency-Key` required.
 */
export const reportsEndpoints = {
  create: defineEndpoint({
    id: "reports.create",
    method: "POST",
    path: "/api/reports",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: REPORT_BURST_LIMIT,
    body: ReportBody,
    response: ReportResult,
    status: 201,
    errors: ["not_found", "idempotency_key_reused"],
    maxBodyBytes: REPORT_MAX_BODY_BYTES,
    summary: "Reports a problem with a Mistake Bank position or a puzzle",
  }),
} as const;
