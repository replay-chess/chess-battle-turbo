// Server-side review events from the web (phase-03 plan §10.1): `analysis_queued` when A3 created the job. Sent with
// posthog-node inside `after()`, `distinct_id` = the viewer's public ref, `app_env` on every event; validated against
// the registry schema first (`@repo/analytics` reviewServerEvents), so a wrong property set is dropped, not sent.
// Skipped when no PostHog key is configured (local dev, unit tests). Never throws.
import { reviewServerEvents } from "@repo/analytics";
import type { z } from "zod";

type ReviewServerEvents = typeof reviewServerEvents;
export type ReviewServerEventName = keyof ReviewServerEvents;

type Capturer = {
  capture(e: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  flush(): Promise<void>;
};

export type ReviewEventSink = (event: ReviewServerEventName, properties: Record<string, unknown>, distinctId: string) => void;

let capturer: Capturer | null | undefined;
let sink: ReviewEventSink | null = null;

/** Test seam: records events instead of sending them; returns a restore function. */
export function setReviewEventSink(next: ReviewEventSink | null): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

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

/**
 * The distinct id of server events with no signed-in user behind them (the ISR render of `/r/<code>`). One constant:
 * a share code is a bearer capability, so it must never become a PostHog person (plan §10: distinct_id is
 * User.referenceId; anonymous server events share this id; FIX-1).
 */
export const ANONYMOUS_SERVER_DISTINCT_ID = "anonymous:server";

export async function captureReviewServerEvent<N extends ReviewServerEventName>(
  event: N,
  props: z.input<ReviewServerEvents[N]>,
  distinctId: string,
): Promise<void> {
  try {
    const parsed = reviewServerEvents[event].safeParse(props);
    if (!parsed.success) return;
    const properties = { ...(parsed.data as Record<string, unknown>), app_env: appEnv() };
    if (sink) {
      sink(event, properties, distinctId);
      return;
    }
    const client = await getCapturer();
    if (!client) return;
    client.capture({ distinctId, event, properties });
    await client.flush();
  } catch {
    // Telemetry never fails a request.
  }
}
