import * as Sentry from "@sentry/nextjs";

// The one logger for web code (server, edge and client). `lib/sentry/logger.ts` was merged
// into this file (plan §3.2 H7, AA F-05).
//
// Rules:
// - Never log bodies, emails, tokens or exception text into a response; context values are
//   ids and small enums only.
// - `error(msg, err, ctx)` sends the error object to Sentry as an exception, so production
//   500s arrive with a stack, the request trace and the context as `extra`.

const isDev = process.env.NODE_ENV === "development";

export type LogContext = Record<string, string | number | boolean | null | undefined>;

function getTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (!span) return undefined;
  const rootSpan = Sentry.getRootSpan(span);
  return rootSpan?.spanContext().traceId ?? span.spanContext().traceId;
}

function formatPrefix(context?: LogContext): string {
  const parts: string[] = [];
  const traceId = getTraceId();
  if (traceId) parts.push(`trace=${traceId}`);
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) parts.push(`${key}=${value}`);
    }
  }
  return parts.length > 0 ? `[${parts.join(" ")}]` : "";
}

function prefixed(message: string, context?: LogContext): string {
  const prefix = formatPrefix(context);
  return prefix ? `${prefix} ${message}` : message;
}

/**
 * Sends `err` to Sentry as an exception. A non-Error value (a string, a rejected plain
 * object) is wrapped so Sentry still gets a stack for the call site; the original value's
 * type is kept in `extra`, never its content (it can carry user input).
 */
function captureError(message: string, err: unknown, context?: LogContext): void {
  const extra: Record<string, unknown> = { ...context, log_message: message };
  if (err instanceof Error) {
    Sentry.captureException(err, { extra });
    return;
  }
  extra.thrown_type = err === null ? "null" : typeof err;
  Sentry.captureException(new Error(message), { extra });
}

export const logger = {
  info(message: string, context?: LogContext): void {
    const formatted = prefixed(message, context);
    if (isDev) console.log(formatted);
    Sentry.logger.info(formatted);
  },

  warn(message: string, context?: LogContext): void {
    const formatted = prefixed(message, context);
    if (isDev) console.warn(formatted);
    Sentry.logger.warn(formatted);
  },

  /**
   * Logs at error level. With `err`, also reports it to Sentry as an exception with
   * `context` as `extra` (AA F-05). Without `err`, it is a log line only.
   */
  error(message: string, err?: unknown, context?: LogContext): void {
    const formatted = prefixed(message, context);
    if (isDev) {
      if (err !== undefined) {
        console.error(formatted, err);
      } else {
        console.error(formatted);
      }
    }
    Sentry.logger.error(formatted);
    if (err !== undefined) captureError(message, err, context);
  },

  debug(message: string, context?: LogContext): void {
    if (isDev) {
      const formatted = prefixed(message, context);
      console.log(formatted);
    }
  },
};
