import * as Sentry from "@sentry/node";

Sentry.init({
  // Sentry project replay-chess-uf/replay-chess-websocket; unset disables reporting
  dsn: process.env.SENTRY_DSN,
  // APP_ENV is "dev" on the dev server and "production" on prod.
  environment: process.env.APP_ENV || process.env.NODE_ENV || "development",
  tracesSampleRate: 1,
  enableLogs: true,
  // No IP addresses, cookies or request bodies in events (plan §10.2).
  sendDefaultPii: false,
  serverName: "web-socket",
});
