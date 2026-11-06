// Server-side game events (phase-02 plan §10.1): `bot_game_started` (POST /api/games) and `bot_game_completed`
// (POST /api/games/[ref]/complete), sent with posthog-node inside `after()`, so telemetry never delays or fails a
// response. `distinct_id` is the viewer's public ref (never an email or a Clerk id). Skipped when no PostHog key is
// configured. The registry (`@repo/analytics`) owns the property sets; the e2e sink validates them.
import type { EventProps, GameServerEventName } from "@repo/analytics";

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

/** Sends one registered game server event. Call it inside `after()`. Never throws. */
export async function captureGameServerEvent<N extends GameServerEventName>(
  event: N,
  props: EventProps<N>,
  distinctId: string,
): Promise<void> {
  try {
    const client = await getCapturer();
    if (!client) return;
    client.capture({ distinctId, event, properties: { ...props, app_env: appEnv() } });
    await client.flush();
  } catch {
    // Telemetry must never fail a game request.
  }
}
