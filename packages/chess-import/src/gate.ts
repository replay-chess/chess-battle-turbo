// Per-provider gate (phase-04 plan §7.7.2, §8.6 "holds the Chess.com gate one request at a time", §8.7 "one stream
// at a time globally", §8.11 429 row, R-CC-02, R-LI-06):
//
// - **Serial**: at most one request (or one Lichess stream) in flight per gate; waiters are served FIFO.
// - **Global pause**: a 429 pauses every caller until `pauseUntil`. The pause is the larger of the provider's
//   `Retry-After` and the next step of the back-off ladder (Chess.com 60 s; Lichess 60 → 120 → 240 → 480 → 900 s).
//   The ladder resets after a call that succeeds.
// - **Wait cap**: a caller can say how long it is willing to wait (the worker's lookup endpoint: 5 s, D4-23). It is
//   refused at once with `rate_limited` when the gate is paused past its cap, or when the cap expires in the queue.
// - **Spacing** (`minIntervalMs`, default 0): the scripts (recorder, canary) leave a polite gap between requests.
//
// One process holds one gate per provider (the worker's `WK/src/providers/gate.ts` owns those instances and wraps
// this class; the scripts make their own). All timing runs on the injected `Clock`.
import { ProviderError, isProviderError, type Provider } from "./errors";
import { realClock, type Clock } from "./http";

export const PAUSE_LADDER_SEC: Readonly<Record<Provider, readonly number[]>> = {
  chesscom: [60],
  lichess: [60, 120, 240, 480, 900],
};

export interface GateOptions {
  provider: Provider;
  clock?: Clock;
  /** Back-off ladder in seconds; defaults to `PAUSE_LADDER_SEC[provider]`. */
  pauseLadderSec?: readonly number[];
  /** Minimum gap between the starts of two calls. */
  minIntervalMs?: number;
}

export interface AcquireOptions {
  /** Give up (with `rate_limited`) after waiting this long for the gate. */
  maxWaitMs?: number;
  signal?: AbortSignal;
}

export interface GateSnapshot {
  held: boolean;
  waiting: number;
  pauseUntil: number;
  /** Consecutive 429s since the last success (the ladder index). */
  strikes: number;
}

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (e: unknown) => void;
  deadline: number | null;
  cleanup: () => void;
};

export class ProviderGate {
  readonly provider: Provider;
  private readonly clock: Clock;
  private readonly ladder: readonly number[];
  private readonly minIntervalMs: number;
  private readonly queue: Waiter[] = [];
  private held = false;
  private lastStartAt = Number.NEGATIVE_INFINITY;
  private pauseUntilMs = 0;
  private strikes = 0;
  private timerAt: number | null = null;
  private timerStop: AbortController | null = null;

  constructor(opts: GateOptions) {
    this.provider = opts.provider;
    this.clock = opts.clock ?? realClock;
    this.ladder = opts.pauseLadderSec ?? PAUSE_LADDER_SEC[opts.provider];
    if (this.ladder.length === 0) throw new RangeError("pause ladder must not be empty");
    this.minIntervalMs = Math.max(0, opts.minIntervalMs ?? 0);
  }

  get pauseUntil(): number {
    return this.pauseUntilMs;
  }

  snapshot(): GateSnapshot {
    return { held: this.held, waiting: this.queue.length, pauseUntil: this.pauseUntilMs, strikes: this.strikes };
  }

  /** Waits for the gate and returns its release function (call it exactly once; extra calls are ignored). */
  acquire(opts: AcquireOptions = {}): Promise<() => void> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new ProviderError(this.provider, "aborted", `${this.provider} gate wait aborted`));
        return;
      }
      const now = this.clock.now();
      const deadline = opts.maxWaitMs == null ? null : now + Math.max(0, opts.maxWaitMs);
      if (deadline !== null && this.pauseUntilMs > deadline) {
        reject(this.waitRefused(now));
        return;
      }
      const onAbort = () => {
        this.remove(waiter);
        reject(new ProviderError(this.provider, "aborted", `${this.provider} gate wait aborted`));
        this.pump();
      };
      const waiter: Waiter = {
        resolve,
        reject,
        deadline,
        cleanup: () => opts.signal?.removeEventListener("abort", onAbort),
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
      this.pump();
    });
  }

  /**
   * Runs `fn` holding the gate. A `rate_limited` ProviderError from `fn` pauses the gate (ladder + Retry-After)
   * before it is rethrown; a success resets the ladder.
   */
  async run<T>(fn: () => Promise<T>, opts: AcquireOptions = {}): Promise<T> {
    const release = await this.acquire(opts);
    try {
      const out = await fn();
      this.succeeded();
      return out;
    } catch (e) {
      if (isProviderError(e) && e.kind === "rate_limited") this.pause(e.retryAfterSec);
      throw e;
    } finally {
      release();
    }
  }

  /** Records a success: the next 429 starts the ladder from its first step again. */
  succeeded(): void {
    this.strikes = 0;
  }

  /**
   * Pauses every caller. Returns the new `pauseUntil` (ms). `retryAfterSec` (from the provider) lengthens the
   * ladder step, never shortens it.
   */
  pause(retryAfterSec: number | null = null): number {
    const step = this.ladder[Math.min(this.strikes, this.ladder.length - 1)]!;
    this.strikes += 1;
    const sec = Math.max(step, retryAfterSec ?? 0);
    this.pauseUntilMs = Math.max(this.pauseUntilMs, this.clock.now() + sec * 1000);
    this.pump();
    return this.pauseUntilMs;
  }

  private waitRefused(now: number): ProviderError {
    const retryAfterSec = this.pauseUntilMs > now ? Math.ceil((this.pauseUntilMs - now) / 1000) : null;
    return new ProviderError(this.provider, "rate_limited", `${this.provider} gate busy`, { retryAfterSec });
  }

  private remove(w: Waiter): void {
    const i = this.queue.indexOf(w);
    if (i >= 0) this.queue.splice(i, 1);
    w.cleanup();
  }

  private readyAt(): number {
    return Math.max(this.pauseUntilMs, this.lastStartAt + this.minIntervalMs);
  }

  private pump(): void {
    const now = this.clock.now();
    // Refuse waiters whose cap has passed, or whose cap ends before a pause does.
    for (const w of [...this.queue]) {
      if (w.deadline !== null && (now > w.deadline || this.pauseUntilMs > w.deadline)) {
        this.remove(w);
        w.reject(this.waitRefused(now));
      }
    }
    if (!this.held && this.queue.length > 0 && now >= this.readyAt()) {
      const w = this.queue.shift()!;
      w.cleanup();
      this.held = true;
      this.lastStartAt = now;
      let released = false;
      w.resolve(() => {
        if (released) return;
        released = true;
        this.held = false;
        this.pump();
      });
    }
    this.arm(now);
  }

  /** Keeps one clock timer for the next moment the queue can change (gate ready or a cap expiring). */
  private arm(now: number): void {
    let next = Number.POSITIVE_INFINITY;
    if (!this.held && this.queue.length > 0) next = this.readyAt();
    for (const w of this.queue) if (w.deadline !== null) next = Math.min(next, w.deadline + 1);
    if (!Number.isFinite(next)) next = Number.NaN;
    if (Number.isNaN(next) || next <= now) {
      if (Number.isNaN(next)) this.disarm();
      return;
    }
    if (this.timerAt === next) return;
    this.disarm();
    const stop = new AbortController();
    this.timerStop = stop;
    this.timerAt = next;
    void this.clock.sleep(next - now, stop.signal).then(() => {
      if (stop.signal.aborted) return;
      this.timerAt = null;
      this.timerStop = null;
      this.pump();
    });
  }

  private disarm(): void {
    this.timerStop?.abort();
    this.timerStop = null;
    this.timerAt = null;
  }
}
