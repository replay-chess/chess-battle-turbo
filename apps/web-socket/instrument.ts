import * as Sentry from "@sentry/node";

Sentry.init({
  // Sentry project replay-chess-uf/replay-chess-websocket; unset disables reporting
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,
  serverName: "web-socket",
});
