import * as Sentry from "@sentry/nextjs";

const isDev = process.env.NODE_ENV === "development";

/**
 * Extracts the current Sentry trace ID from the active span.
 */
function getTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (!span) return undefined;
  const rootSpan = Sentry.getRootSpan(span);
  return rootSpan?.spanContext().traceId ?? span.spanContext().traceId;
}

function formatPrefix(context?: Record<string, string>): string {
  const parts: string[] = [];
  const traceId = getTraceId();
  if (traceId) parts.push(`trace=${traceId}`);
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.length > 0 ? `[${parts.join(" ")}]` : "";
}

export const logger = {
  info(message: string, context?: Record<string, string>) {
    const prefix = formatPrefix(context);
    const formatted = prefix ? `${prefix} ${message}` : message;
    if (isDev) console.log(formatted);
    Sentry.logger.info(formatted);
  },

  warn(message: string, context?: Record<string, string>) {
    const prefix = formatPrefix(context);
    const formatted = prefix ? `${prefix} ${message}` : message;
    if (isDev) console.warn(formatted);
    Sentry.logger.warn(formatted);
  },

  error(message: string, err?: unknown, context?: Record<string, string>) {
    const prefix = formatPrefix(context);
    const formatted = prefix ? `${prefix} ${message}` : message;
    if (isDev) {
      if (err) {
        console.error(formatted, err);
      } else {
        console.error(formatted);
      }
    }
    Sentry.logger.error(formatted);
  },
};
