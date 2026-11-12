// The lag pause (phase-03 plan P3-D8, §8.12 step 5): the worker shares the dev VM with the socket server, so between
// two searches it asks the socket's `GET /internal/load` (signed `wk`, docker network only; polled at most once a
// second) and waits in 200 ms steps while the socket's event-loop lag p99 is above LAG_PAUSE_MS or the socket is
// draining for a deploy. Live games always win over analysis.
//
// The probe fails open: when the socket cannot be reached (it is restarting, or the worker runs without one) the
// worker does not pause, because a missing socket has no live games to protect. A continuous pause is capped at
// 60 s, after which one search runs, so a socket stuck in `draining` can slow a job down but never stall it past the
// heartbeat rule.
import { z } from "zod";
import { signInternal, type KeyRing } from "@repo/contracts/internal/auth";
import type { Clock } from "../scheduler/clock";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";

export const LOAD_PATH = "/internal/load";
export const LOAD_POLL_MIN_MS = 1_000;
export const PAUSE_STEP_MS = 200;
export const MAX_CONTINUOUS_PAUSE_MS = 60_000;
const LOAD_TIMEOUT_MS = 1_000;

/** `GET /internal/load` (WP-E; CT/socket/internal.ts LoadResponse). Parsed leniently: extra fields are ignored. */
export const LoadSample = z.object({
  loopLagP99Ms: z.number().min(0),
  liveGames: z.number().int().min(0),
  sockets: z.number().int().min(0),
  draining: z.boolean(),
});
export type LoadSample = z.infer<typeof LoadSample>;

export interface LoadSource {
  read(): Promise<LoadSample | null>;
}

export class LoadProbe implements LoadSource {
  private last: { atMs: number; sample: LoadSample | null } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: {
      baseUrl: string | null;
      keys: KeyRing;
      clock: Clock;
      log: Logger;
      fetchImpl?: typeof fetch;
      minIntervalMs?: number;
    },
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** The latest sample, at most one request per second; null when the socket cannot be read. */
  async read(): Promise<LoadSample | null> {
    const now = this.opts.clock.now();
    if (this.last && now - this.last.atMs < (this.opts.minIntervalMs ?? LOAD_POLL_MIN_MS)) return this.last.sample;
    const sample = await this.fetchSample(now);
    this.last = { atMs: now, sample };
    return sample;
  }

  private async fetchSample(nowMs: number): Promise<LoadSample | null> {
    if (!this.opts.baseUrl) return null;
    try {
      const headers = signInternal({ keys: this.opts.keys, method: "GET", path: LOAD_PATH, body: "", nowMs });
      const res = await this.fetchImpl(`${this.opts.baseUrl}${LOAD_PATH}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
      });
      if (!res.ok) {
        await res.arrayBuffer().catch(() => undefined);
        this.opts.log.debug("load probe refused", { status: res.status });
        return null;
      }
      const parsed = LoadSample.safeParse(await res.json());
      return parsed.success ? parsed.data : null;
    } catch (error) {
      this.opts.log.debug("load probe failed", { error });
      return null;
    }
  }
}

export class LagPause {
  constructor(
    private readonly opts: {
      source: LoadSource;
      thresholdMs: number;
      clock: Clock;
      metrics: Metrics;
      stepMs?: number;
      maxPauseMs?: number;
    },
  ) {}

  /** True when the socket needs the CPU right now. */
  static busy(sample: LoadSample | null, thresholdMs: number): boolean {
    return sample !== null && (sample.draining || sample.loopLagP99Ms > thresholdMs);
  }

  /** Waits while the socket is busy (call between two searches). Returns the milliseconds paused. */
  async waitForCapacity(signal?: AbortSignal): Promise<number> {
    const step = this.opts.stepMs ?? PAUSE_STEP_MS;
    const cap = this.opts.maxPauseMs ?? MAX_CONTINUOUS_PAUSE_MS;
    const started = this.opts.clock.now();
    while (!signal?.aborted && this.opts.clock.now() - started < cap) {
      if (!LagPause.busy(await this.opts.source.read(), this.opts.thresholdMs)) break;
      await this.opts.clock.sleep(step, signal);
    }
    const paused = this.opts.clock.now() - started;
    this.opts.metrics.lagPauseMs += paused;
    return paused;
  }
}
