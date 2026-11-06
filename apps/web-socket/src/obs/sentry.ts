// Sentry adapters of the socket server (phase-02 plan 10.2). `Sentry.init` runs first in src/instrument.ts
// (errors 100 %, traces 10 %, `sendDefaultPii: false`, metrics on); without SENTRY_DSN every call here is a no-op.
// The per-game `continueTrace` of v1 is gone (socket F-40): errors carry the game ref as a tag instead.
import * as Sentry from "@sentry/node";
import type { LogFields } from "../ports";
import type { MetricsSink } from "./metrics";

/** Only these log fields become Sentry tags (refs, plies and enums; never names, emails or tokens). */
const TAG_FIELDS = ["game", "ply", "phase", "op", "reason", "event", "code"] as const;

function tagsOf(fields: LogFields | undefined): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!fields) return tags;
  for (const key of TAG_FIELDS) {
    const v = fields[key];
    if (v !== undefined && v !== null) tags[key] = String(v).slice(0, 64);
  }
  return tags;
}

/** An `error` log entry → a Sentry issue (the logger's `onError`). */
export function reportError(message: string, fields: LogFields | undefined, error: unknown): void {
  Sentry.withScope((scope) => {
    scope.setTags(tagsOf(fields));
    scope.setExtra("message", message);
    if (error instanceof Error) Sentry.captureException(error);
    else Sentry.captureMessage(error === undefined ? message : `${message}: ${String(error)}`, "error");
  });
}

/** A warning that should be visible in Sentry without an exception (e.g. `ws.restore{result:"journal_newer"}`). */
export function reportWarning(message: string, fields?: LogFields): void {
  Sentry.withScope((scope) => {
    scope.setTags(tagsOf(fields));
    Sentry.captureMessage(message, "warning");
  });
}

/** Metrics sink for the 60 s push (src/obs/metrics.ts). */
export function sentryMetricsSink(): MetricsSink {
  return {
    count(name, value, tags) {
      Sentry.metrics.count(name, value, { attributes: tags });
    },
    gauge(name, value, tags, unit) {
      Sentry.metrics.gauge(name, value, { attributes: tags, ...(unit ? { unit } : {}) });
    },
  };
}

export function flushSentry(timeoutMs: number): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}
