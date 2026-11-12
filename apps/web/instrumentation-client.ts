// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { loadPosthog } from "./lib/analytics/posthog-client";
import { posthogRedactShareCodes, replayShareRedaction, sentryShareRedaction } from "./lib/analytics/share-redaction";
import { loadSentry, loadedSentry, sentryEnabled } from "./lib/sentry/lazy";
import type { NavigationType } from "./lib/shell/nav-history";
import "./lib/shell/nav-history";

// Sentry loads after start-up (lib/sentry/lazy.ts, FIX-2): the SDK left the shared First Load JS of every route. Errors
// thrown before it has loaded are kept here (at most EARLY_MAX) and reported once init has run.
const EARLY_MAX = 20;
const early: unknown[] = [];
const keepEarly = (e: ErrorEvent | PromiseRejectionEvent) => {
  if (early.length < EARLY_MAX) early.push("reason" in e ? e.reason : (e.error ?? e.message));
};
if (sentryEnabled()) {
  window.addEventListener("error", keepEarly);
  window.addEventListener("unhandledrejection", keepEarly);
}

void loadSentry().then((Sentry) => {
  if (!Sentry) return;
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // "dev" on the dev deployment, "production" on prod, NODE_ENV locally.
    environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development",

    // Session Replay is lazy-loaded below (FIX-1): bundled, it put ~38 kB gzipped of rrweb into every route's first load.
    integrations: [],

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

    // Share codes (/r/<code>, a bearer capability) are rewritten to /r/:code in every event, transaction and
    // breadcrumb before it leaves the browser (lib/analytics/share-redaction.ts, FIX-2).
    ...sentryShareRedaction,
  });
  window.removeEventListener("error", keepEarly);
  window.removeEventListener("unhandledrejection", keepEarly);
  for (const e of early.splice(0)) Sentry.captureException(e);
  // Session Replay (sampled as configured above), fetched from Sentry's CDN after start-up, so it never weighs on the
  // first load (the /r Lighthouse gate, G5).
  void Sentry.lazyLoadIntegration("replayIntegration")
    .then((replay) => Sentry.addIntegration(replay(replayShareRedaction)))
    .catch(() => undefined);
});

/**
 * Records the Sentry navigation span, then tells the app shell a navigation
 * started (SPEC 3.10): the route hairline and the in-app history counter
 * (lib/shell/nav-history.ts, imported above so it counts from the first load)
 * listen for `rc:navigation-start`.
 */
export function onRouterTransitionStart(url: string, navigationType: NavigationType) {
  // Before the SDK has loaded there is no tracing to attach the navigation to.
  loadedSentry()?.captureRouterTransitionStart(url, navigationType);
  window.dispatchEvent(new CustomEvent("rc:navigation-start", { detail: { url, navigationType } }));
}

// PostHog product analytics. Events go through the /ingest proxy in
// next.config.js; nothing is sent when the key is unset (local dev, CI). The client is its own chunk, loaded here only
// when the key is set (lib/analytics/posthog-client.ts; FIX-1: it used to ship in every route's first load).
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (posthogKey) loadPosthog((posthog) => {
  posthog.init(posthogKey, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    capture_pageview: "history_change",
    capture_pageleave: true,
    person_profiles: "identified_only",
    // /r/<code> → /r/:code in $current_url, $pathname, $referrer and every other property (FIX-2).
    before_send: posthogRedactShareCodes,
  });
  // Tag every event with the deployment so dev traffic never mixes with prod.
  posthog.register({ app_env: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV });
});
