// Server-side product events (phase-02 plan 10.1, 7.8): `game_started`, `game_ended`, `game_aborted`,
// `rematch_expired` come from the reducer's `track` effects and go to PostHog with `posthog-node` (`distinct_id` =
// the user ref; never FEN, PGN or move text). Batched (`flushAt: 20`, `flushInterval: 10 s`) and flushed on drain.
// Unset POSTHOG_PROJECT_KEY → events are skipped. In CI and local e2e POSTHOG_HOST points at P1's telemetry sink.
import { PostHog } from "posthog-node";
import type { Logger, Telemetry } from "../ports";

export interface ServerTelemetry extends Telemetry {
  /** Flushes the queue (drain). Resolves within `timeoutMs`. */
  shutdown(timeoutMs?: number): Promise<void>;
}

export const NOOP_SERVER_TELEMETRY: ServerTelemetry = {
  capture() {},
  shutdown: () => Promise.resolve(),
};

export function createPostHogTelemetry(
  config: { key: string; host: string } | null,
  log: Logger,
  options: { flushAt?: number; flushIntervalMs?: number } = {},
): ServerTelemetry {
  if (!config) return NOOP_SERVER_TELEMETRY;
  const client = new PostHog(config.key, {
    host: config.host,
    flushAt: options.flushAt ?? 20,
    flushInterval: options.flushIntervalMs ?? 10_000,
  });
  client.on("error", (error: unknown) => log.warn("posthog delivery failed", { err: String(error) }));
  return {
    capture(event, distinctId, props) {
      try {
        client.capture({ distinctId, event, properties: props });
      } catch (error) {
        log.warn("posthog capture failed", { event, err: String(error) });
      }
    },
    async shutdown(timeoutMs = 3_000) {
      try {
        await client.shutdown(timeoutMs);
      } catch (error) {
        log.warn("posthog shutdown failed", { err: String(error) });
      }
    },
  };
}
