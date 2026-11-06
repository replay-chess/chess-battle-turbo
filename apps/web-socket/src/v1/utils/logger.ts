import * as Sentry from "@sentry/node";

/**
 * Extracts the current Sentry trace ID from the active span.
 * When called inside withGameTrace(), this returns the game's shared traceId.
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
    console.log(prefix ? `${prefix} ${message}` : message);
  },

  warn(message: string, context?: Record<string, string>) {
    const prefix = formatPrefix(context);
    console.warn(prefix ? `${prefix} ${message}` : message);
  },

  error(message: string, err?: unknown, context?: Record<string, string>) {
    const prefix = formatPrefix(context);
    if (err) {
      console.error(prefix ? `${prefix} ${message}` : message, err);
    } else {
      console.error(prefix ? `${prefix} ${message}` : message);
    }
  },

  debug(message: string, context?: Record<string, string>) {
    if (process.env.NODE_ENV === "development") {
      const prefix = formatPrefix(context);
      console.log(prefix ? `${prefix} ${message}` : message);
    }
  },
};
