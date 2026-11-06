import * as Sentry from "@sentry/node";

Sentry.init({
  // Sentry project replay-chess-uf/replay-chess-websocket; unset disables reporting
  dsn: process.env.SENTRY_DSN,
  // APP_ENV is "dev" on the dev server and "production" on prod.
  environment: process.env.APP_ENV || process.env.NODE_ENV || "development",
  // Commands are sampled at 10 %; errors are always sent (phase-02 plan 10.2).
  tracesSampleRate: 0.1,
  enableLogs: true,
  // The 60 s metrics push of src/obs/metrics.ts (ws.loop_lag_ms, ws.outbox.*, ws.persist.*, …).
  enableMetrics: true,
  // No IP addresses, cookies or request bodies in events (plan §10.2).
  sendDefaultPii: false,
  serverName: "web-socket",
});
