// The worker's PostHog events (phase-03 plan §10, §10.1): `analysis_started`, `analysis_ready`, `analysis_failed`
// and `analysis_retry_succeeded`, sent with posthog-node to the HTTP `/batch` endpoint, batched every 5 s.
// `distinct_id` = the member's `User.referenceId` (ARCH X14); every event carries `app_env`.
//
// Every event is checked against the registry (`@repo/analytics` reviewServerEvents, strict schemas) before it is
// queued: an event that would fail the e2e telemetry fixture is dropped and logged here instead, and the PII guard
// (`findPii`) refuses FEN/PGN/SAN shapes. Unset POSTHOG_PROJECT_KEY (local runs, tests) → nothing is sent.
import { findPii, parseEvent, type ReviewServerEventName } from "@repo/analytics";
import type { z } from "zod";
import type { reviewServerEvents } from "@repo/analytics";
import { PostHog } from "posthog-node";
import type { AppEnvName } from "../config/env";
import type { Logger } from "./log";

export type WorkerEventName = Extract<
  ReviewServerEventName,
  "analysis_started" | "analysis_ready" | "analysis_failed" | "analysis_retry_succeeded"
>;
export type WorkerEventProps<N extends WorkerEventName> = z.input<(typeof reviewServerEvents)[N]>;

export interface ProductEvents {
  capture<N extends WorkerEventName>(event: N, distinctId: string, props: WorkerEventProps<N>): void;
  /** Sends what is queued (drain end, shutdown). */
  flush(): Promise<void>;
  shutdown(timeoutMs?: number): Promise<void>;
}

export const noopProductEvents: ProductEvents = {
  capture: () => undefined,
  flush: async () => undefined,
  shutdown: async () => undefined,
};

/** Validates one event against the registry and the PII guard. Returns the reason it is refused, or null. */
export function refuseEvent(event: string, props: Record<string, unknown>): string | null {
  const parsed = parseEvent(event, props);
  if (!parsed.ok) return parsed.error;
  const pii = findPii(props);
  return pii.length ? `${event}: PII-shaped value in ${pii.map((p) => p.path).join(", ")}` : null;
}

/** Batches every 5 s (§10). */
export const POSTHOG_FLUSH_INTERVAL_MS = 5_000;

export function createProductEvents(
  config: { key: string; host: string } | null,
  appEnv: AppEnvName,
  log: Logger,
  options: { flushAt?: number; flushIntervalMs?: number } = {},
): ProductEvents {
  if (!config) return noopProductEvents;
  const client = new PostHog(config.key, {
    host: config.host,
    flushAt: options.flushAt ?? 20,
    flushInterval: options.flushIntervalMs ?? POSTHOG_FLUSH_INTERVAL_MS,
  });
  client.on("error", (error: unknown) => log.warn("posthog delivery failed", { error }));
  return {
    capture(event, distinctId, props) {
      const properties = { ...(props as Record<string, unknown>), app_env: appEnv };
      const refused = refuseEvent(event, properties);
      if (refused) {
        log.error("telemetry event refused", { event, reason: refused });
        return;
      }
      try {
        client.capture({ distinctId, event, properties });
      } catch (error) {
        log.warn("posthog capture failed", { event, error });
      }
    },
    async flush() {
      try {
        await client.flush();
      } catch (error) {
        log.warn("posthog flush failed", { error });
      }
    },
    async shutdown(timeoutMs = 3_000) {
      try {
        await client.shutdown(timeoutMs);
      } catch (error) {
        log.warn("posthog shutdown failed", { error });
      }
    },
  };
}

/** Collects events in memory (unit tests), validating each exactly like the real client. */
export class RecordingProductEvents implements ProductEvents {
  readonly events: { event: WorkerEventName; distinctId: string; props: Record<string, unknown> }[] = [];
  readonly refused: string[] = [];

  constructor(private readonly appEnv: AppEnvName = "test") {}

  capture<N extends WorkerEventName>(event: N, distinctId: string, props: WorkerEventProps<N>): void {
    const properties = { ...(props as Record<string, unknown>), app_env: this.appEnv };
    const refused = refuseEvent(event, properties);
    if (refused) {
      this.refused.push(refused);
      return;
    }
    this.events.push({ event, distinctId, props: properties });
  }

  async flush(): Promise<void> {}
  async shutdown(): Promise<void> {}

  named(event: WorkerEventName) {
    return this.events.filter((e) => e.event === event);
  }
}
