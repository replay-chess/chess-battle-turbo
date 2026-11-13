// Server-side onboarding events (phase-04 plan §7.2: `onb_completed_server` after PATCH {complete}). Sent with
// posthog-node inside `after()`, so telemetry never delays or fails the response; `distinct_id` is the viewer's
// public ref. Skipped when no PostHog key is configured (CI's sink points POSTHOG_HOST at the local collector).
// Server code only (posthog-node); no `server-only` marker, so the route contract tests can load the ME-4 route.
import type { OnboardingServerEventName, OnboardingServerProps } from "@repo/analytics/events/onboarding";

type Capturer = {
  capture(e: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  flush(): Promise<void>;
};

let capturer: Capturer | null | undefined;

async function getCapturer(): Promise<Capturer | null> {
  if (capturer !== undefined) return capturer;
  const key = process.env.POSTHOG_PROJECT_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    capturer = null;
    return capturer;
  }
  const { PostHog } = await import("posthog-node");
  capturer = new PostHog(key, {
    host: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
    disableGeoip: true,
  });
  return capturer;
}

function appEnv(): "local" | "dev" | "test" | "production" {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  return env === "dev" || env === "test" || env === "production" ? env : "local";
}

/** Sends one onboarding server event (`@repo/analytics` events/onboarding.ts). Call it inside `after()`. Never throws. */
export async function captureOnboardingServerEvent<N extends OnboardingServerEventName>(
  event: N,
  props: OnboardingServerProps<N>,
  distinctId: string,
): Promise<void> {
  try {
    const client = await getCapturer();
    if (!client) return;
    client.capture({ distinctId, event, properties: { ...props, app_env: appEnv() } });
    await client.flush();
  } catch {
    // Telemetry must never fail an onboarding request.
  }
}
