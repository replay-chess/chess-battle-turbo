// System events (phase-01 plan §10.1). Client events are sent by `trackSystem()`
// in apps/web/lib/analytics/system-events.ts (1B·F8); server events by
// posthog-node `capture` inside `after()` (1B·F4a / F4b). Closed property sets:
// identifiers are registry ids or route templates, never ids of people, emails
// or query text.
import { z } from "zod";

/** `@repo/contracts` route registry id, e.g. "me.get" or "billing.refresh". */
const routeId = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
/** Rate-limit bucket id from the route spec, e.g. "me" or "openings:ip". */
const bucket = z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/);
/** Next.js route template (`/game/[gameId]`), not the concrete URL. */
const routeTemplate = z.string().regex(/^\/[A-Za-z0-9_\-/[\]().]{0,127}$/);
/** `ErrorCode` from `@repo/contracts/http/codes` (snake_case). */
const errorCode = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const paymentBannerState = z.enum(["banner", "last_day", "expired"]);

export const systemClientEvents = {
  rate_limited_shown: z
    .object({
      route_id: routeId,
      bucket,
      retry_after_sec: z.number().int().min(0).max(86_400),
      surface: z.enum(["inline", "page"]),
    })
    .strict(),
  rate_limited_retry: z
    .object({
      route_id: routeId,
      waited_sec: z.number().int().min(0).max(86_400),
      result: z.enum(["ok", "limited_again"]),
    })
    .strict(),
  session_expired_shown: z
    .object({
      source: z.enum(["api_401", "clerk", "visibility", "broadcast"]),
      route_template: routeTemplate,
    })
    .strict(),
  session_expired_action: z.object({ action: z.enum(["sign_in", "different_account"]) }).strict(),
  payment_banner_shown: z.object({ state: paymentBannerState }).strict(),
  payment_banner_cta: z.object({ state: paymentBannerState }).strict(),
  payment_banner_dismissed: z.object({}).strict(),
  payment_banner_undo: z.object({}).strict(),
  api_error_toast: z
    .object({
      route_id: routeId,
      code: errorCode,
      status: z.number().int().min(400).max(599),
    })
    .strict(),
} as const;

/** Server-side events (posthog-node, `distinct_id = viewer.ref`). */
export const systemServerEvents = {
  webhook_processed: z
    .object({
      provider: z.enum(["dodo", "clerk"]),
      // Provider event type, e.g. "subscription.active" or "user.created".
      type: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
      outcome: z.enum(["applied", "duplicate", "stale", "unmatched", "ignored", "error"]),
      changed: z.boolean(),
      lag_ms: z.number().int(),
    })
    .strict(),
  billing_refreshed: z
    .object({
      result: z.enum(["changed", "unchanged", "upstream_down"]),
      source: z.enum(["activation", "membership", "checkout"]),
    })
    .strict(),
} as const;

export const systemEvents = { ...systemClientEvents, ...systemServerEvents } as const;

export type SystemEvents = typeof systemEvents;
export type SystemEventName = keyof SystemEvents;
