// Sentry metrics from code shared by the browser and the server. The SDK is loaded lazily in the browser
// (lib/sentry/lazy.ts, FIX-2): a static import put it into the first load of every route that tracks a timing.
import { withSentry } from "@/lib/sentry/lazy";

export function trackUserAction(action: string, attributes?: Record<string, string | number | boolean>) {
  withSentry((Sentry) => Sentry.metrics.count("user_action", 1, { attributes: { action, ...attributes } }));
}

export function trackApiResponseTime(endpoint: string, durationMs: number) {
  withSentry((Sentry) =>
    Sentry.metrics.distribution("api_response_time", durationMs, {
      unit: "millisecond",
      attributes: { endpoint },
    }),
  );
}
