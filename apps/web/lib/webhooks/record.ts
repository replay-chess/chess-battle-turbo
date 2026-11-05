/**
 * Webhook idempotency (plan phase-01 §7.7, API §8.1; table `webhook_events`, migration M1).
 *
 * Every webhook route verifies the signature first, then calls `recordWebhook()`: that INSERT is the
 * first database statement. No row back means another delivery of the same event already claimed it,
 * and the route answers `200 { duplicate: true }` with no other work. After handling, `finishWebhook()`
 * writes the outcome. The claim re-admits only failed deliveries and ones stuck without an outcome for
 * more than 2 minutes (a crashed or timed-out attempt), so a provider retry after a 500 is processed.
 *
 * Clerk payloads are never stored (PII); Dodo payloads are kept 180 days (cron `webhook-retention`).
 */
import type { EventProps } from "@repo/analytics";

export type WebhookProvider = "dodo" | "clerk";
export type WebhookStatus = "applied" | "ignored" | "stale" | "unmatched" | "error";

export interface WebhookOutcome {
  status: WebhookStatus;
  /** users.id once resolved. */
  userId?: bigint | null;
  /** False when the event was applied but changed nothing (no write, no claims sync). */
  changed?: boolean;
  /** Safe message, never a stack or a payload. Cut to 500 characters. */
  error?: string | null;
}

/** The claim statement, verbatim from plan §7.7 (times stored as UTC `timestamp(3)`). */
export const CLAIM_SQL = `INSERT INTO webhook_events (provider, "eventId", type, "eventTime", payload)
VALUES ($1, $2, $3, ($4::timestamptz AT TIME ZONE 'UTC'), $5::jsonb)
ON CONFLICT (provider, "eventId") DO UPDATE
  SET "receivedAt" = (now() AT TIME ZONE 'UTC'), status = NULL, error = NULL
  WHERE webhook_events.status = 'error'
     OR (webhook_events.status IS NULL AND webhook_events."receivedAt" < (now() AT TIME ZONE 'UTC') - interval '2 minutes')
RETURNING 1 AS claimed`;

/** The outcome statement (plan §6.3: PK index scan). */
export const FINISH_SQL = `UPDATE webhook_events
SET status = $3, "userId" = $4, error = $5, "processedAt" = (now() AT TIME ZONE 'UTC')
WHERE provider = $1 AND "eventId" = $2`;

/** Column limits from the schema. */
export const EVENT_ID_MAX = 100;
export const TYPE_MAX = 64;
export const ERROR_MAX = 500;

export interface WebhookSql {
  query(sql: string, ...params: unknown[]): Promise<unknown[]>;
  execute(sql: string, ...params: unknown[]): Promise<number>;
}

async function defaultSql(): Promise<WebhookSql> {
  const { prisma } = await import("@/lib/prisma");
  return {
    query: (sql, ...params) => prisma.$queryRawUnsafe<unknown[]>(sql, ...params),
    execute: (sql, ...params) => prisma.$executeRawUnsafe(sql, ...params),
  };
}

/** The parameters of the claim statement, in order. Pure, for tests. */
export function claimParams(
  provider: WebhookProvider,
  eventId: string,
  type: string,
  eventTime: Date | null,
  payload: unknown,
): [string, string, string, string | null, string | null] {
  if (!eventId || eventId.length > EVENT_ID_MAX) throw new Error(`webhook event id must be 1..${EVENT_ID_MAX} characters`);
  const time = eventTime && !Number.isNaN(eventTime.getTime()) ? eventTime.toISOString() : null;
  // Clerk payloads carry names and emails: never stored, whatever the caller passes.
  const body = provider === "clerk" || payload === undefined || payload === null ? null : JSON.stringify(payload);
  return [provider, eventId, (type || "unknown").slice(0, TYPE_MAX), time, body];
}

/**
 * Claims an event. True: this delivery owns it and must process it. False: a duplicate (already
 * processed, or being processed by a concurrent delivery for less than 2 minutes).
 */
export async function recordWebhook(
  provider: WebhookProvider,
  eventId: string,
  type: string,
  eventTime: Date | null,
  payload: unknown,
  sql?: WebhookSql,
): Promise<boolean> {
  const db = sql ?? (await defaultSql());
  const rows = await db.query(CLAIM_SQL, ...claimParams(provider, eventId, type, eventTime, payload));
  return rows.length > 0;
}

/** The parameters of the outcome statement, in order. Pure, for tests. */
export function finishParams(
  provider: WebhookProvider,
  eventId: string,
  outcome: WebhookOutcome,
): [string, string, string, bigint | null, string | null] {
  const error = outcome.error ? outcome.error.slice(0, ERROR_MAX) : null;
  return [provider, eventId, outcome.status, outcome.userId ?? null, error];
}

/** Writes the outcome onto the claimed row. */
export async function finishWebhook(
  provider: WebhookProvider,
  eventId: string,
  outcome: WebhookOutcome,
  sql?: WebhookSql,
): Promise<void> {
  const db = sql ?? (await defaultSql());
  await db.execute(FINISH_SQL, ...finishParams(provider, eventId, outcome));
}

/** `logger.error` that never throws (a logging failure must not change a webhook's answer). */
export function safeLogError(message: string, err?: unknown, context?: Record<string, string>): void {
  void import("@/lib/logger")
    .then(({ logger }) => logger.error(message, err, context))
    .catch(() => {});
}

/** A short, safe description of a handler failure for `webhook_events.error` (no stack, no payload). */
export function safeErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return `${(err as { name?: string }).name ?? "Error"} ${(err as { code: string }).code}`.slice(0, ERROR_MAX);
  }
  return (err instanceof Error ? err.name : "Error").slice(0, ERROR_MAX);
}

// ── Telemetry: server event `webhook_processed` (plan §10.1) ─────────────────────────────────────

export type WebhookProcessedProps = EventProps<"webhook_processed">;

/** Event props from an outcome. `lag_ms = receivedAt − eventTime` (0 when the provider sent no time). */
export function webhookProcessedProps(
  provider: WebhookProvider,
  type: string,
  outcome: WebhookStatus | "duplicate",
  changed: boolean,
  eventTime: Date | null,
  receivedAt: Date,
): WebhookProcessedProps {
  const safeType = /^[a-z][a-z0-9_.]{0,63}$/.test(type) ? type : "unknown";
  const lag = eventTime ? Math.max(0, Math.round(receivedAt.getTime() - eventTime.getTime())) : 0;
  return { provider, type: safeType, outcome, changed, lag_ms: lag };
}

type Capturer = {
  capture(e: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  flush(): Promise<void>;
};
let capturer: Capturer | null | undefined;

async function getCapturer(): Promise<Capturer | null> {
  if (capturer !== undefined) return capturer;
  const key = process.env.POSTHOG_PROJECT_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    capturer = null;
    return capturer;
  }
  const { PostHog } = await import("posthog-node");
  capturer = new PostHog(key, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });
  return capturer;
}

function appEnv(): "local" | "dev" | "test" | "production" {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  return env === "dev" || env === "test" || env === "production" ? env : "local";
}

/**
 * Sends `webhook_processed` to PostHog. Call it inside `after()`. Never throws. `distinctId` is the
 * user's public reference id when known, else a fixed system id (never an email or a Clerk id).
 */
export async function captureWebhookProcessed(props: WebhookProcessedProps, distinctId?: string | null): Promise<void> {
  try {
    const client = await getCapturer();
    if (!client) return;
    client.capture({
      distinctId: distinctId || `system:webhook:${props.provider}`,
      event: "webhook_processed",
      properties: { ...props, app_env: appEnv() },
    });
    await client.flush();
  } catch {
    // Telemetry must never fail a webhook.
  }
}

// ── The shared flow both webhook routes run after verifying the signature ─────────────────────────

/** Thrown by `processWebhook` when the handler failed; the event is already marked `error`. */
export class WebhookHandlerError extends Error {
  constructor(readonly provider: WebhookProvider, readonly original: unknown) {
    super(`${provider} webhook handler failed`);
    this.name = "WebhookHandlerError";
  }
}

export interface ProcessWebhookInput<O extends WebhookOutcome> {
  provider: WebhookProvider;
  eventId: string;
  type: string;
  eventTime: Date | null;
  /** Stored for Dodo only; ignored for Clerk. */
  payload: unknown;
  /** Request time (ctx.now), for `lag_ms`. */
  receivedAt: Date;
  handle: () => Promise<O>;
  /** route()'s `after()`: side effects run after the response. */
  after: (task: () => unknown) => void;
  /** Extra side effect for a processed (non-duplicate) event, run inside after(). */
  onProcessed?: (outcome: O) => unknown;
  /** The user's reference id for the telemetry distinct id. */
  userRefOf?: (outcome: O) => string | null | undefined;
  sql?: WebhookSql;
  capture?: typeof captureWebhookProcessed;
}

/**
 * Claim → handle → record the outcome → side effects in after() (plan §7.7 shared rules).
 * Returns `{ duplicate: true }` with no other work when the claim returns no row. A handler
 * exception marks the event `error` and throws `WebhookHandlerError` (the route answers 500, so the
 * provider retries and the claim re-admits the retry).
 */
export async function processWebhook<O extends WebhookOutcome>(input: ProcessWebhookInput<O>): Promise<{ duplicate: boolean }> {
  const { provider, eventId, type, eventTime, receivedAt } = input;
  const capture = input.capture ?? captureWebhookProcessed;

  const claimed = await recordWebhook(provider, eventId, type, eventTime, input.payload, input.sql);
  if (!claimed) {
    input.after(() => capture(webhookProcessedProps(provider, type, "duplicate", false, eventTime, receivedAt)));
    return { duplicate: true };
  }

  let outcome: O;
  try {
    outcome = await input.handle();
  } catch (err) {
    await finishWebhook(provider, eventId, { status: "error", error: safeErrorMessage(err) }, input.sql);
    input.after(() => capture(webhookProcessedProps(provider, type, "error", false, eventTime, receivedAt)));
    throw new WebhookHandlerError(provider, err);
  }

  await finishWebhook(provider, eventId, outcome, input.sql);
  const changed = outcome.changed ?? outcome.status === "applied";
  const ref = input.userRefOf?.(outcome) ?? null;
  input.after(async () => {
    if (input.onProcessed) await input.onProcessed(outcome);
    await capture(webhookProcessedProps(provider, type, outcome.status, changed, eventTime, receivedAt), ref);
  });
  if (outcome.status === "error") {
    // e.g. the billing compare-and-set gave up: answer 500 so the provider retries.
    throw new WebhookHandlerError(provider, new Error(outcome.error ?? "error"));
  }
  return { duplicate: false };
}
