// The worker → socket hop (phase-03 plan P3-D13, §7.4): `POST {WS_INTERNAL_URL}/internal/emit` with P2's body
// `{v:1, targets:[{userRef}] ≤ 50, event, data, dedupeKey?}`, signed with the worker's `wk` key (P3-D21). Only the
// game's member players are ever targets ("analysis private to players", §11.2 rule 1): callers pass the refs a
// statement read from `game_players`.
//
// Emits are best effort: a failure is logged and counted, never thrown into a job (the client heals through the
// review status fallback, §5.2). A network error or a 5xx is retried once; a 4xx is a bug and is not retried. The
// retry waits until the next second: the signature covers the unix-second timestamp and the body, and the socket's
// replay guard remembers every signature it verified, so a same-second retry of the same body would be refused.
import { signInternal, type KeyRing } from "@repo/contracts/internal/auth";
import type { AnalysisEventName, AnalysisEventPayload } from "@repo/contracts/socket/analysis";
import { EMIT_MAX_TARGETS } from "@repo/contracts/socket/limits";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";

export const EMIT_PATH = "/internal/emit";
export const EMIT_TIMEOUT_MS = 2_000;
/** > 1 s, so the retry's signature carries a later timestamp than the first attempt's. */
export const EMIT_RETRY_DELAY_MS = 1_100;

export type EmitResult = "sent" | "skipped" | "failed";

export interface EmitterOptions {
  baseUrl: string | null;
  keys: KeyRing;
  log: Logger;
  metrics: Metrics;
  nowMs: () => number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Waits between the attempts (tests pass a fake). */
  sleep?: (ms: number) => Promise<void>;
}

export interface EmitSink {
  emit<N extends AnalysisEventName>(
    event: N,
    data: AnalysisEventPayload<N>,
    userRefs: readonly string[],
    options?: { dedupeKey?: string },
  ): Promise<EmitResult>;
}

export class Emitter implements EmitSink {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: EmitterOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? EMIT_TIMEOUT_MS;
  }

  async emit<N extends AnalysisEventName>(
    event: N,
    data: AnalysisEventPayload<N>,
    userRefs: readonly string[],
    options: { dedupeKey?: string } = {},
  ): Promise<EmitResult> {
    const refs = [...new Set(userRefs)];
    if (refs.length === 0) return "skipped";
    if (!this.opts.baseUrl) {
      this.opts.log.debug("emit skipped: no WS_INTERNAL_URL", { event });
      return "skipped";
    }
    let result: EmitResult = "sent";
    for (let i = 0; i < refs.length; i += EMIT_MAX_TARGETS) {
      const targets = refs.slice(i, i + EMIT_MAX_TARGETS).map((userRef) => ({ userRef }));
      const body = JSON.stringify({ v: 1, targets, event, data, ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}) });
      if ((await this.post(event, body)) === "failed") result = "failed";
    }
    if (result === "sent") this.opts.metrics.emitted(event);
    return result;
  }

  private async post(event: string, body: string): Promise<EmitResult> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(EMIT_RETRY_DELAY_MS);
      try {
        // Signed per attempt (a later second than the first): a repeated signature is refused as a replay.
        const headers = signInternal({ keys: this.opts.keys, method: "POST", path: EMIT_PATH, body, nowMs: this.opts.nowMs() });
        const res = await this.fetchImpl(`${this.opts.baseUrl}${EMIT_PATH}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        await res.arrayBuffer().catch(() => undefined);
        if (res.status === 202 || res.ok) return "sent";
        if (res.status < 500) {
          this.opts.log.error("emit refused", { event, status: res.status });
          return "failed";
        }
        this.opts.log.warn("emit failed", { event, status: res.status, attempt });
      } catch (error) {
        this.opts.log.warn("emit error", { event, attempt, error });
      }
    }
    return "failed";
  }
}

/** Collects emits in memory (unit tests, and the worker when it runs without a socket server). */
export class RecordingEmitter implements EmitSink {
  readonly sent: { event: AnalysisEventName; data: unknown; userRefs: string[]; dedupeKey?: string }[] = [];

  async emit<N extends AnalysisEventName>(
    event: N,
    data: AnalysisEventPayload<N>,
    userRefs: readonly string[],
    options: { dedupeKey?: string } = {},
  ): Promise<EmitResult> {
    this.sent.push({ event, data, userRefs: [...userRefs], ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}) });
    return userRefs.length === 0 ? "skipped" : "sent";
  }
}
