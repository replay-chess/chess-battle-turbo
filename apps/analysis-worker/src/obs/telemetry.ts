// Error reporting, tracing, metrics and the HOUSEKEEPING cron monitor (phase-03 plan §10.2): `@sentry/node` when
// SENTRY_DSN is set (environment = APP_ENV, release = the build), a no-op otherwise (local runs, tests: telemetry
// blank). Context carries refs and codes, never names.
//
// - Tracing: `span(name, attributes, fn)` runs `fn` inside a Sentry span; the outermost one of a job is a
//   transaction (`job.analyze`, `job.legend_compare`, sample rate 1.0: low volume) and the nested ones are its child
//   spans (`load`, `pass1`, `classify`, `pass2`, `text`, `write`). Async context propagation parents them.
// - Metrics: `metric(kind, name, value, attributes)` → Sentry's metrics API (`enableMetrics`). The same gauges are
//   always served from memory by `GET /internal/metrics` (obs/metrics.ts), which the daily cron backstop reads, so a
//   plan without Sentry metrics loses nothing ([V4]).
import { redactDeep } from "@repo/chess-import/redact";

export type CronStatus = "in_progress" | "ok" | "error";
export type MetricKind = "count" | "distribution" | "gauge";
export type Attributes = Record<string, string | number | boolean>;

export interface Telemetry {
  captureException(error: unknown, context?: Record<string, string | number | boolean | null | undefined>): void;
  /** Returns the check-in id to pass back with the closing status. */
  cronCheckIn(monitor: string, status: CronStatus, checkInId?: string): string | undefined;
  /** Runs `fn` inside a span; the outermost span of a job is a transaction. */
  span<T>(name: string, attributes: Attributes, fn: () => Promise<T>, options?: { transaction?: boolean }): Promise<T>;
  metric(kind: MetricKind, name: string, value: number, attributes?: Attributes): void;
  flush(timeoutMs: number): Promise<void>;
  /**
   * Runs `fn` with tracing suppressed, for the worker's own telemetry delivery (PostHog's `/batch` requests). Without
   * it the fetch integration records a PostHog flush that fires while a job runs (its 5 s timer started in the job's
   * async context) as an `http.client` span of that job's transaction (regression: posthog-batch-span).
   */
  untraced?<T>(fn: () => T): T;
}

export const noopTelemetry: Telemetry = {
  captureException: () => undefined,
  cronCheckIn: () => undefined,
  span: (_name, _attributes, fn) => fn(),
  metric: () => undefined,
  flush: async () => undefined,
};

/** Records spans and metrics in memory (unit tests). Span order is the order they started. */
export class RecordingTelemetry implements Telemetry {
  readonly spans: { name: string; attributes: Attributes; parent: string | null; transaction: boolean }[] = [];
  readonly metrics: { kind: MetricKind; name: string; value: number; attributes: Attributes }[] = [];
  readonly exceptions: { error: unknown; context: Record<string, unknown> }[] = [];
  readonly checkIns: { monitor: string; status: CronStatus }[] = [];
  private readonly stack: string[] = [];

  captureException(error: unknown, context: Record<string, unknown> = {}): void {
    this.exceptions.push({ error, context });
  }

  cronCheckIn(monitor: string, status: CronStatus): string | undefined {
    this.checkIns.push({ monitor, status });
    return `${monitor}-${this.checkIns.length}`;
  }

  async span<T>(
    name: string,
    attributes: Attributes,
    fn: () => Promise<T>,
    options: { transaction?: boolean } = {},
  ): Promise<T> {
    this.spans.push({
      name,
      attributes,
      parent: this.stack[this.stack.length - 1] ?? null,
      transaction: options.transaction === true,
    });
    this.stack.push(name);
    try {
      return await fn();
    } finally {
      this.stack.pop();
    }
  }

  metric(kind: MetricKind, name: string, value: number, attributes: Attributes = {}): void {
    this.metrics.push({ kind, name, value, attributes });
  }

  async flush(): Promise<void> {}

  named(name: string) {
    return this.metrics.filter((m) => m.name === name);
  }
}

/**
 * Sentry hooks that drop provider usernames (plan §11.3, FIX-1): the default fetch/http integrations record every
 * Chess.com and Lichess call of an import as a child span and a breadcrumb with the full URL
 * (`/pub/player/<u>/games/YYYY/MM`, `/api/games/user/<u>?…`). Every string of an event, transaction and breadcrumb
 * goes through `redactUsernames` (@repo/chess-import/redact) before it leaves the worker.
 */
export const workerSentryRedaction = {
  beforeSend: <E>(event: E): E => redactDeep(event),
  beforeSendTransaction: <E>(event: E): E => redactDeep(event),
  beforeBreadcrumb: <B>(breadcrumb: B): B => redactDeep(breadcrumb),
};

export async function sentryTelemetry(opts: { dsn: string; environment: string; release: string }): Promise<Telemetry> {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    tracesSampleRate: 1.0,
    sendDefaultPii: false,
    enableMetrics: true,
    ...workerSentryRedaction,
  });
  return {
    captureException(error, context) {
      Sentry.withScope((scope) => {
        for (const [k, v] of Object.entries(context ?? {})) if (v !== undefined) scope.setTag(k, String(v));
        Sentry.captureException(error);
      });
    },
    cronCheckIn(monitor, status, checkInId) {
      if (status === "in_progress") return Sentry.captureCheckIn({ monitorSlug: monitor, status });
      // A closing check-in without the opening id still records the outcome (Sentry pairs it by slug).
      return Sentry.captureCheckIn({ checkInId: checkInId ?? "", monitorSlug: monitor, status });
    },
    span(name, attributes, fn, options = {}) {
      return Sentry.startSpan({ name, op: name, attributes, forceTransaction: options.transaction === true }, () =>
        fn(),
      );
    },
    metric(kind, name, value, attributes) {
      const o = attributes ? { attributes } : undefined;
      if (kind === "count") Sentry.metrics.count(name, value, o);
      else if (kind === "gauge") Sentry.metrics.gauge(name, value, o);
      else Sentry.metrics.distribution(name, value, o);
    },
    async flush(timeoutMs) {
      await Sentry.flush(timeoutMs);
    },
    untraced(fn) {
      return Sentry.suppressTracing(fn);
    },
  };
}
