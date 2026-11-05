// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { sentryScrubOptions } from "./lib/sentry/scrub";
import { tracesSampler } from "./lib/sentry/traces-sampler";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // "dev" on the dev deployment, "production" on prod, NODE_ENV locally.
  environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development",

  // Per-route sampling (plan §10.2): billing and webhooks always, health never, pages 1.0
  // on dev, 0.1 otherwise. An incoming socket-server trace keeps its parent's decision.
  tracesSampler: (ctx) => tracesSampler(ctx),

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // No default PII. Users are identified by their reference id only, set explicitly (plan §10.2, AA F-13).
  // In @sentry/nextjs 10 `sendDefaultPii: false` removes only the IP: request headers (Clerk session JWT,
  // Bearer CRON_SECRET, x-internal-token, test tokens), cookies and bodies are still attached. `beforeSend` /
  // `beforeSendTransaction` strip them in code (lib/sentry/scrub.ts).
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
  ...sentryScrubOptions,
});
