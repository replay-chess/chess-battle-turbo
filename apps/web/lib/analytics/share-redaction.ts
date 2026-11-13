// Share codes never reach telemetry (phase-03 plan §10, §11.3; FIX-2). A `/r/<code>` link is a bearer capability: anyone
// holding the URL can read the review, so the code must not land in PostHog (`$current_url`, `$pathname`,
// `$referrer`, the pageview of the island) or Sentry (request URLs, navigation breadcrumbs and spans, Replay's
// recording events). Every telemetry path rewrites `/r/<code>` to `/r/:code` before anything is sent:
//   - PostHog: `before_send` (instrumentation-client.ts posthog.init);
//   - Sentry, browser: `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb` and Replay's `beforeAddRecordingEvent`;
//   - Sentry, server and edge: lib/sentry/scrub.ts scrubEvent.
// The /r page itself also sends `Referrer-Policy: no-referrer`, so the next page never learns the code (next.config.js).
// Phase 4 (plan §11.3, FIX-1): the same hooks drop provider usernames and emails — the Confirm/Link steps carry `?u=`,
// Dodo's return adds `email=`, and provider API URLs (`/pub/player/<u>`, `/api/games/user/<u>`) appear in fetch spans
// and breadcrumbs (`redactUsernames` from @repo/chess-import/redact).
// Pure and dependency-free (besides that pure module): it ships in the browser's instrumentation chunk.
import { redactDeep, redactUsernames } from "@repo/chess-import/redact";

/** The path segment that replaces every share code. */
export const SHARE_CODE_PLACEHOLDER = ":code";

/** `/r/<code>` with what may follow a path segment (end, `/`, `?`, `#`, `&`, quotes, whitespace, brackets). */
const SHARE_PATH = /\/r\/[A-Za-z0-9_-]{1,40}(?=$|[/?#&"'\s)\]<>,])/g;

/** `https://x/r/7kd0cbpz/og?v=2` → `https://x/r/:code/og?v=2`; any other string unchanged. */
export function redactSharePath(value: string): string {
  return value.includes("/r/") ? value.replace(SHARE_PATH, `/r/${SHARE_CODE_PLACEHOLDER}`) : value;
}

/** Share codes, then provider usernames and personal query values (`?u=`, `email=`; @repo/chess-import/redact). */
export function redactTelemetryString(value: string): string {
  return redactUsernames(redactSharePath(value));
}

/**
 * Rewrites every string inside `value` (objects and arrays are changed in place, so telemetry hooks can return the
 * same event) and returns the redacted value: share codes (FIX-2, P3) and, since P4 FIX-1, provider usernames and the
 * `u` / `email` query values (plan §11.3). Depth-limited; non-plain objects (Date, Error, typed arrays) are kept.
 */
export function redactShareDeep<T>(value: T, depth = 0): T {
  return redactDeep(value, redactTelemetryString, depth);
}

/** PostHog `before_send`: the event's properties, `$set` and `$set_once` (URLs, paths, referrers, initial ones). */
export function posthogRedactShareCodes<E extends { properties?: unknown; $set?: unknown; $set_once?: unknown } | null>(event: E): E {
  if (!event) return event;
  redactShareDeep(event.properties);
  redactShareDeep(event.$set);
  redactShareDeep(event.$set_once);
  return event;
}

/** Sentry browser hooks: every event, transaction, breadcrumb and Replay recording event. */
export const sentryShareRedaction = {
  beforeSend: <E>(event: E): E => redactShareDeep(event),
  beforeSendTransaction: <E>(event: E): E => redactShareDeep(event),
  beforeBreadcrumb: <B>(breadcrumb: B): B => redactShareDeep(breadcrumb),
};

/** Replay option: the recording's own copies of URLs (navigation events, the page's meta href, span descriptions). */
export const replayShareRedaction = {
  beforeAddRecordingEvent: <E>(event: E): E => redactShareDeep(event),
};
