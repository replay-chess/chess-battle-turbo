// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import posthog from "posthog-js";
import type { NavigationType } from "./lib/shell/nav-history";
import "./lib/shell/nav-history";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // "dev" on the dev deployment, "production" on prod, NODE_ENV locally.
  environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // 10% of client traces (phase-01 plan 10.2): enough for p75 navigation timings within the free quota.
  tracesSampleRate: 0.1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // No IPs, cookies or request bodies (phase-01 plan 10.2). A Sentry user, when set, is { id: ref }, never the
  // email. https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: false,
});

/**
 * Records the Sentry navigation span, then tells the app shell a navigation
 * started (SPEC 3.10): the route hairline and the in-app history counter
 * (lib/shell/nav-history.ts, imported above so it counts from the first load)
 * listen for `rc:navigation-start`.
 */
export function onRouterTransitionStart(url: string, navigationType: NavigationType) {
  Sentry.captureRouterTransitionStart(url, navigationType);
  window.dispatchEvent(new CustomEvent("rc:navigation-start", { detail: { url, navigationType } }));
}

// PostHog product analytics. Events go through the /ingest proxy in
// next.config.js; nothing is sent when the key is unset (local dev, CI).
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    capture_pageview: "history_change",
    capture_pageleave: true,
    person_profiles: "identified_only",
  });
  // Tag every event with the deployment so dev traffic never mixes with prod.
  posthog.register({ app_env: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV });
}
