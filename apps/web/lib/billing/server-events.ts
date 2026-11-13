// Server-side billing events (phase-04 plan 10.1): `trial_started` and `subscription_activated` from the entitlement
// fan-out, `trial_ledger_hit` from the checkout. posthog-node inside `after()`, `distinct_id` = the user's public ref,
// `app_env` on every event; validated against `@repo/analytics/events/billing` first (a wrong property set is
// dropped, never sent). Skipped without a PostHog key (local dev, unit tests). Never throws.
import { billingServerEvents } from "@repo/analytics/events/billing";
import type { z } from "zod";

type ServerEvents = typeof billingServerEvents;
export type BillingServerEventName = keyof ServerEvents;
export type BillingServerEventProps<N extends BillingServerEventName> = z.input<ServerEvents[N]>;

type Capturer = {
  capture(e: { distinctId: string; event: string; properties: Record<string, unknown> }): void;
  flush(): Promise<void>;
};

export type BillingEventSink = (event: BillingServerEventName, properties: Record<string, unknown>, distinctId: string) => void;

let capturer: Capturer | null | undefined;
let sink: BillingEventSink | null = null;

/** Test seam: records events instead of sending them; returns a restore function. */
export function setBillingEventSink(next: BillingEventSink | null): () => void {
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
  capturer = new PostHog(key, { host: process.env.POSTHOG_HOST || "https://us.i.posthog.com", flushAt: 1, flushInterval: 0, disableGeoip: true });
  return capturer;
}

function appEnv(): "local" | "dev" | "test" | "production" {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  return env === "dev" || env === "test" || env === "production" ? env : "local";
}

export async function captureBillingServerEvent<N extends BillingServerEventName>(
  event: N,
  props: BillingServerEventProps<N>,
  distinctId: string,
): Promise<void> {
  try {
    const parsed = billingServerEvents[event].safeParse(props);
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
    // Telemetry never fails a billing write.
  }
}
