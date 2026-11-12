// `analysis:batch` (phase-03 plan §5.11, P3-D26, AP-10): analyses below band 80 that nobody watches (backfills,
// regrade sweeps, P4 imports) send no per-game frames. Each member collects `{done, failed, refs}` here, and gets at
// most one coalesced frame per ANALYSIS_BATCH_EVERY_MS (60 s): after a job when the member's window has passed,
// and at the end of a drain. A member still inside the window at the end of a drain is flushed by one timer when the
// window ends. `queued` (what is still waiting for the member) is read with one statement per flush, for every
// member in it; an idle worker therefore still issues no query (nothing pending, no timer).
import { ANALYSIS_BATCH_EVERY_MS, ANALYSIS_BATCH_MAX_REFS } from "@repo/contracts/socket/analysis";
import type { Logger } from "../obs/log";
import type { Clock, TimerHandle } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import { buildEvent } from "../socket/events";

interface Pending {
  done: number;
  failed: number;
  /** Most recent first, unique. */
  refs: string[];
}

export interface BatchAccumulatorOptions {
  emitter: EmitSink;
  clock: Clock;
  log: Logger;
  /** QUEUED analyses per member ref (one statement). */
  queuedFor(userRefs: readonly string[]): Promise<Map<string, number>>;
  intervalMs?: number;
}

export class BatchAccumulator {
  private readonly pending = new Map<string, Pending>();
  private readonly lastSentAtMs = new Map<string, number>();
  private timer: TimerHandle | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private readonly intervalMs: number;

  constructor(private readonly opts: BatchAccumulatorOptions) {
    this.intervalMs = opts.intervalMs ?? ANALYSIS_BATCH_EVERY_MS;
  }

  /** A background analysis of `gameRef` finished (`done`) or failed for these members. */
  add(userRefs: readonly string[], gameRef: string, outcome: "done" | "failed"): void {
    for (const ref of new Set(userRefs)) {
      const p = this.pending.get(ref) ?? { done: 0, failed: 0, refs: [] };
      if (outcome === "done") p.done++;
      else p.failed++;
      p.refs = [gameRef, ...p.refs.filter((r) => r !== gameRef)].slice(0, ANALYSIS_BATCH_MAX_REFS);
      this.pending.set(ref, p);
    }
  }

  get pendingUsers(): number {
    return this.pending.size;
  }

  /** Flushes every member whose 60 s window has passed. */
  flushDue(): Promise<void> {
    return this.enqueue(() => this.flush(false));
  }

  /** End of a drain: flush the due members now and arm one timer for the rest. */
  flushAtDrainEnd(): Promise<void> {
    return this.enqueue(() => this.flush(true));
  }

  /**
   * Shutdown (SIGTERM): every member still pending gets its frame now, inside its 60 s window or not, because nothing
   * is left to flush it later; then the timer is cancelled (regression: batch-frames-dropped-on-stop, FIX-2).
   */
  flushAll(): Promise<void> {
    return this.enqueue(async () => {
      await this.flush(false, true);
      this.stop();
    });
  }

  /** Cancels the timer (shutdown). */
  stop(): void {
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.flushing = this.flushing.then(work, work);
    return this.flushing;
  }

  private due(ref: string, now: number): boolean {
    const last = this.lastSentAtMs.get(ref);
    return last === undefined || now - last >= this.intervalMs;
  }

  private async flush(armRest: boolean, all = false): Promise<void> {
    const now = this.opts.clock.now();
    const due = [...this.pending.keys()].filter((ref) => all || this.due(ref, now));
    if (due.length > 0) {
      let queued: Map<string, number>;
      try {
        queued = await this.opts.queuedFor(due);
      } catch (error) {
        // Keep everything pending: the next flush (next job, drain end or the timer) tries again.
        // A failed read is retried after a full window, never in a loop.
        this.opts.log.warn("analysis:batch queued count failed", { error });
        if (!all) this.armAt(now + this.intervalMs, now);
        return;
      }
      for (const ref of due) {
        const p = this.pending.get(ref);
        if (!p) continue;
        this.pending.delete(ref);
        this.lastSentAtMs.set(ref, this.opts.clock.now());
        const data = buildEvent("analysis:batch", {
          done: p.done,
          failed: p.failed,
          queued: queued.get(ref) ?? 0,
          refs: p.refs,
        });
        await this.opts.emitter.emit("analysis:batch", data, [ref]);
      }
    }
    if (armRest) this.arm(now);
  }

  /** One timer for the earliest window end among the members still pending. */
  private arm(now: number): void {
    if (this.pending.size === 0) {
      this.stop();
      return;
    }
    let next = Infinity;
    for (const ref of this.pending.keys()) {
      const last = this.lastSentAtMs.get(ref);
      next = Math.min(next, last === undefined ? now : last + this.intervalMs);
    }
    this.armAt(next, now);
  }

  private armAt(atMs: number, now: number): void {
    this.opts.clock.clearTimeout(this.timer);
    this.timer = this.opts.clock.setTimeout(
      () => {
        this.timer = null;
        void this.flushAtDrainEnd();
      },
      Math.max(0, atMs - now),
    );
  }
}
