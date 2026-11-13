// Server-side account events from the web (phase-04 plan §10.1): `account_linked`, `account_unlinked`,
// `account_lookup_fallback_used`. Sent with posthog-node inside `after()` (`distinct_id` = the viewer's public ref,
// `app_env` on every event), only after the event's schema in the @repo/analytics registry accepts the properties:
// a wrong property set is dropped rather than sent. No usernames,
// emails or handles ever (PII guard, §10.1). Skipped without a PostHog key (local dev, unit tests). Never throws.
import { EVENTS, isEventName, type AccountsServerEventName } from "@repo/analytics";

export type { AccountsServerEventName };
export type AccountsEventSink = (event: AccountsServerEventName, properties: Record<string, unknown>, distinctId: string) => void;

type Capturer = { capture(e: { distinctId: string; event: string; properties: Record<string, unknown> }): void; flush(): Promise<void> };

let capturer: Capturer | null | undefined;
let sink: AccountsEventSink | null = null;

/** Test seam: records validated events instead of sending them; returns a restore function. */
export function setAccountsEventSink(next: AccountsEventSink | null): () => void {
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

/** Validates against the registry, then sends (or hands to the test sink). Returns whether it was accepted. */
export async function captureAccountsServerEvent(
  event: AccountsServerEventName,
  props: Record<string, unknown>,
  distinctId: string,
): Promise<boolean> {
  try {
    if (!isEventName(event)) return false;
    const parsed = (EVENTS[event] as unknown as { safeParse(v: unknown): { success: boolean; data?: unknown } }).safeParse(props);
    if (!parsed.success) return false;
    const properties = { ...(parsed.data as Record<string, unknown>), app_env: appEnv() };
    if (sink) {
      sink(event, properties, distinctId);
      return true;
    }
    const client = await getCapturer();
    if (!client) return true;
    client.capture({ distinctId, event, properties });
    await client.flush();
    return true;
  } catch {
    return false;
  }
}
