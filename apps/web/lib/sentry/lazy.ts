// The Sentry SDK behind a dynamic import (FIX-2). `@sentry/nextjs` (~51 kB gzipped) was a static import of
// instrumentation-client.ts, so it sat in the shared First Load JS of every route and held the P3 route budgets
// (phase-03 plan §9.6) and the /r Lighthouse gate (G5) down. Now instrumentation-client.ts starts the import and
// calls init when it resolves; every call site shared with the browser goes through `withSentry` (runs at once once
// loaded, else when the SDK arrives) or `loadedSentry` (synchronous, null before then). On the server and the edge the
// same module is already initialised by instrumentation.ts, so the import resolves at once (lib/logger.ts and
// lib/metrics.ts run on both sides). Nothing loads when there is no DSN. Errors thrown in the browser before init
// are buffered by instrumentation-client.ts and reported once it runs.
type SentrySdk = typeof import("@sentry/nextjs");

let pending: Promise<SentrySdk | null> | null = null;
let sdk: SentrySdk | null = null;

/** Whether a DSN is configured (local dev and the CI/test builds have none: nothing is loaded). */
export function sentryEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
}

/** Loads the SDK once (null without a DSN or when the chunk fails to load). `importer` is a test seam. */
export function loadSentry(importer: () => Promise<SentrySdk> = () => import("@sentry/nextjs")): Promise<SentrySdk | null> {
  if (!sentryEnabled()) return Promise.resolve(null);
  pending ??= importer().then(
    (m) => (sdk = m),
    () => null,
  );
  return pending;
}

/** The SDK if it has loaded, else null (for synchronous call sites that can skip one report). */
export function loadedSentry(): SentrySdk | null {
  return sdk;
}

/** Runs `fn` with the SDK now or once it has loaded; a no-op without a DSN. Telemetry never throws. */
export function withSentry(fn: (sentry: SentrySdk) => void): void {
  if (sdk) {
    try {
      fn(sdk);
    } catch {
      // Telemetry never breaks the app.
    }
    return;
  }
  void loadSentry().then((s) => {
    if (!s) return;
    try {
      fn(s);
    } catch {
      // Telemetry never breaks the app.
    }
  });
}

/** Test seam: forget the loaded SDK. */
export function resetSentryForTests(): void {
  pending = null;
  sdk = null;
}
