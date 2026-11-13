// The worker's loop (phase-03 plan §8.12 "Loop and scheduler", P3-D22, AP-08). No polling:
//
//   boot   → one batch: the reaper + DAILY_PLAN's rows (so a fresh database gets its first HOUSEKEEPING row)
//          → drain()
//   drain  → claim → run → claim … until nothing is due
//          → one batch: the reaper + the queue summary (min("runAt") of what this worker can run, and the gauges)
//   sleep  → until min(that runAt, the runAt values kicks supplied) — capped at 24 h — or until a kick
//
// So an idle worker issues ZERO queries and Neon scales to zero; the only fixed wake is the daily HOUSEKEEPING row
// (21:00 UTC), which DAILY_PLAN always keeps planned. The timer audit (scheduler.test.ts) proves ≤ 5 round trips
// over 24 idle hours.
//
// A kick (`POST /internal/analysis/kick`) cancels the sleep and starts a drain; one that arrives during a drain makes
// the drain look once more before it sleeps, so a job enqueued just after the last claim is never left waiting for
// the next timer. A kick's `runAt` in the future only shortens the sleep. `watch` marks a game as watched for 10
// minutes (P3-D26). With APP_ENV=test a kick's `fault` is stored for its `watch` game (one-shot), and `hold_queue`
// holds every claim until a later `test` kick without it (plan §12.3: "do not claim until a test kick"). Product kicks
// (bot_end, live_end, opened, …) wake the loop but never release the hold, or the finished game under test would end
// the hold it was meant to be observed under.
import { WATCH_TTL_MS, type KickBodyV1, type KickResponse } from "@repo/contracts/internal/kick";
import type { JobKind } from "@repo/contracts/internal/jobs";
import { kickFaultsHonoured, type AppEnvName } from "../config/env";
import { parseFault, type Fault } from "../config/faults";
import { num, numOrNull, type Db, type Statement } from "../db/client";
import type { Logger } from "../obs/log";
import type { Metrics, SchedulerView } from "../obs/metrics";
import { claimJob, type ClaimedJob } from "../queue/claim";
import { queueSummaryStatement } from "../queue/summary";
import { freshSiblingsStatement, ORPHAN_STALE_SEC, reapStatement } from "../queue/outcome";
import { handleReaped } from "../queue/reaper";
import type { ProductEvents } from "../obs/posthog";
import type { Telemetry } from "../obs/telemetry";
import type { EmitSink } from "../socket/emit";
import type { Clock, TimerHandle } from "./clock";

/** The longest sleep (§8.12): DAILY_PLAN guarantees a HOUSEKEEPING row inside every 24 h. */
export const MAX_SLEEP_MS = 24 * 60 * 60 * 1000;
/** When something is due but nothing could be claimed, wait at least this long (doubling up to 60 s). */
export const DUE_FLOOR_MS = 1_000;
const DUE_FLOOR_MAX_MS = 60_000;
/** After a database error in the loop, try again after this long. */
export const ERROR_RETRY_MS = 30_000;
/** A kick `runAt` this close to now wakes the worker at once. */
const KICK_NOW_SLACK_MS = 1_000;

export interface SchedulerOptions {
  db: Db;
  clock: Clock;
  log: Logger;
  metrics: Metrics;
  emitter: EmitSink;
  appEnv: AppEnvName;
  /** `lockedBy` of this boot: `<workerId>-<bootId>`. */
  me: string;
  workerId: string;
  kinds: readonly JobKind[];
  payloadVMax: number;
  /** Runs one claimed job to its outcome (jobs/runner.ts). */
  runJob(job: ClaimedJob, stopSignal: AbortSignal): Promise<unknown>;
  /** DAILY_PLAN's inserts for the boot batch. */
  bootPlan(): Statement[];
  envFault: Fault | null;
  maxSleepMs?: number;
  /** PostHog `analysis_failed` for reaped analyses (§10.1). */
  events?: ProductEvents;
  /** Sentry gauges `worker.queue.depth{band}` / `worker.queue.oldest_s{band}` from each drain-end summary (§10.2). */
  telemetry?: Telemetry;
  /** Runs at the end of every drain, before the reaper + summary batch: the `analysis:batch` flush (§8.12). */
  onDrainEnd?(): Promise<void>;
  /** P4: this boot's other lock ids (the I/O lane slots, queue/lanes.ts): never reaped as another boot's orphans. */
  siblingIds?: readonly string[];
}

// The drain-end summary lives with the other queue statements (queue/summary.ts; explain-hot gates the real text).
export { queueSummaryStatement } from "../queue/summary";

export class Scheduler {
  private draining = false;
  private stopping = false;
  private kickedDuringDrain = false;
  private dbNextRunAtMs: number | null = null;
  private hints: { atMs: number; receivedAtMs: number }[] = [];
  private lastDrainAtMs: number | null = null;
  private dueFloorMs = DUE_FLOOR_MS;
  private sleeping: { resolve: () => void; timer: TimerHandle | null } | null = null;
  private readonly watched = new Map<string, number>();
  private readonly kickFaults = new Map<string, Fault>();
  /**
   * Rows a claim handed to this boot since its last drain-end reap. One of them may still be RUNNING under this boot
   * (a fail write that failed twice), so the claim's retry form never adopts them (claim.ts adoptOrClaimStatement).
   */
  private readonly handedOut = new Set<string>();
  /**
   * When the RUNNING rows of another boot of this WORKER_ID seen at boot can be reaped (their newest heartbeat +
   * ORPHAN_STALE_SEC): one drain then, whose reaper takes them if that boot crashed. A row still beating then belongs
   * to a live worker sharing this WORKER_ID, which is logged as an error and left alone (FIX-2).
   */
  private orphanCheckAtMs: number | null = null;
  private kickHold = false;
  private readonly stopController = new AbortController();
  private loopDone: Promise<void> | null = null;
  private readonly maxSleepMs: number;

  constructor(private readonly opts: SchedulerOptions) {
    this.maxSleepMs = opts.maxSleepMs ?? MAX_SLEEP_MS;
  }

  /** Boot: the reaper (orphans of an earlier boot, stale heartbeats) + DAILY_PLAN in one batch, then the loop. */
  async start(): Promise<void> {
    const [reaped, siblings] = await this.opts.db.batch([
      reapStatement({ workerId: this.opts.workerId, me: this.opts.me, alsoMine: this.opts.siblingIds }),
      freshSiblingsStatement({ workerId: this.opts.workerId, me: this.opts.me, alsoMine: this.opts.siblingIds }),
      ...this.opts.bootPlan(),
    ]);
    await handleReaped(reaped ?? [], this.opts);
    const fresh = siblings?.[0];
    if (fresh && num(fresh.n) > 0) {
      const lastBeatMs = numOrNull(fresh.lastBeatMs) ?? this.opts.clock.now();
      this.orphanCheckAtMs = lastBeatMs + ORPHAN_STALE_SEC * 1000 + 1_000;
      this.opts.log.warn("another boot of this WORKER_ID still holds RUNNING jobs: reaped once their heartbeat stops", {
        workerId: this.opts.workerId,
        rows: num(fresh.n),
        checkAt: this.iso(this.orphanCheckAtMs),
      });
    }
    this.loopDone = this.loop();
  }

  /** SIGTERM: stop claiming, let the running job reach a safe point (it releases itself), then return. */
  async stop(graceMs: number): Promise<void> {
    this.stopping = true;
    this.stopController.abort("stop");
    this.wakeUp();
    if (!this.loopDone) return;
    // The grace timer is cancelled as soon as the loop is done, so nothing keeps the process alive after it.
    const grace = new AbortController();
    await Promise.race([this.loopDone, this.opts.clock.sleep(graceMs, grace.signal)]);
    grace.abort();
  }

  get stopSignal(): AbortSignal {
    return this.stopController.signal;
  }

  kick(body: KickBodyV1): KickResponse {
    const now = this.opts.clock.now();
    if (this.stopping) return { draining: false, nextRunAt: this.iso(this.computeNext()) };
    if (body.watch) this.watched.set(body.watch, now + WATCH_TTL_MS);
    const fault = body.fault && kickFaultsHonoured(this.opts.appEnv) ? parseFault(body.fault) : null;
    if (fault?.kind === "hold_queue") this.kickHold = true;
    else {
      if (body.reason === "test") this.kickHold = false;
      if (fault && body.watch) this.kickFaults.set(body.watch, fault);
    }
    let wakeNow = true;
    if (body.runAt) {
      const at = Date.parse(body.runAt);
      this.hints.push({ atMs: at, receivedAtMs: now });
      if (at > now + KICK_NOW_SLACK_MS) wakeNow = false;
    }
    if (this.draining) this.kickedDuringDrain = true;
    else if (wakeNow && !this.held) this.wakeUp();
    else this.rearm();
    return { draining: this.draining || (wakeNow && !this.held), nextRunAt: this.iso(this.computeNext()) };
  }

  isWatched(gameRef: string): boolean {
    const until = this.watched.get(gameRef);
    if (until === undefined) return false;
    if (until > this.opts.clock.now()) return true;
    this.watched.delete(gameRef);
    return false;
  }

  /** A test kick's one-shot fault for this game, else the env fault (dev/test), else null. */
  takeFault(gameRef: string): Fault | null {
    const once = this.kickFaults.get(gameRef);
    if (once) {
      this.kickFaults.delete(gameRef);
      return once;
    }
    return this.opts.envFault?.kind === "hold_queue" ? null : this.opts.envFault;
  }

  view(): SchedulerView {
    return { draining: this.draining, nextRunAtMs: this.computeNext(), lastDrainAtMs: this.lastDrainAtMs };
  }

  private get held(): boolean {
    return this.kickHold || this.opts.envFault?.kind === "hold_queue";
  }

  // ── loop ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private async loop(): Promise<void> {
    while (!this.stopping) {
      let claimed = 0;
      try {
        claimed = await this.drain();
      } catch (error) {
        // The database is unreachable even after the client's retry: try again in 30 s (a kick still wakes it).
        this.opts.log.error("drain failed", { error });
        this.dbNextRunAtMs = this.opts.clock.now() + ERROR_RETRY_MS;
        this.hints = [];
        this.dueFloorMs = DUE_FLOOR_MS;
      }
      if (this.stopping) break;
      await this.sleep(claimed);
    }
  }

  /** Claims and runs until nothing is due, then reaps and reads the queue summary. Returns the jobs claimed. */
  private async drain(): Promise<number> {
    this.draining = true;
    let claimed = 0;
    try {
      for (;;) {
        this.kickedDuringDrain = false;
        while (!this.stopping && !this.held) {
          const job = await claimJob(this.opts.db, this.opts.me, this.opts.kinds, this.opts.payloadVMax, [
            ...this.handedOut,
          ]);
          if (!job) break;
          this.handedOut.add(job.id);
          claimed++;
          await this.opts.runJob(job, this.stopController.signal);
        }
        if (this.stopping) return claimed;
        if (this.opts.onDrainEnd) {
          await this.opts
            .onDrainEnd()
            .catch((error: unknown) => this.opts.log.warn("drain-end hook failed", { error }));
        }
        const summaryAtMs = this.opts.clock.now();
        const recheck = this.orphanCheckAtMs !== null && summaryAtMs >= this.orphanCheckAtMs;
        const [reaped, summary, siblings] = await this.opts.db.batch([
          reapStatement({ workerId: this.opts.workerId, me: this.opts.me, drainEnd: true, alsoMine: this.opts.siblingIds }),
          queueSummaryStatement(this.opts.kinds, this.opts.payloadVMax),
          ...(recheck
            ? [freshSiblingsStatement({ workerId: this.opts.workerId, me: this.opts.me, alsoMine: this.opts.siblingIds })]
            : []),
        ]);
        if (recheck) {
          this.orphanCheckAtMs = null;
          const n = siblings?.[0] ? num(siblings[0].n) : 0;
          if (n > 0) {
            const message = `another live worker shares WORKER_ID ${this.opts.workerId}: give every worker its own id`;
            this.opts.log.error(message, { rows: n });
            this.opts.telemetry?.captureException(new Error(message), { workerId: this.opts.workerId, rows: n });
          }
        }
        // The drain-end reaper requeued every row this boot still held, so none of the rows handed out can be adopted.
        this.handedOut.clear();
        await handleReaped(reaped ?? [], this.opts);
        this.applySummary(summary?.[0], summaryAtMs);
        if (!this.kickedDuringDrain || this.held || this.stopping) break;
      }
      return claimed;
    } finally {
      this.draining = false;
      this.lastDrainAtMs = this.opts.clock.now();
    }
  }

  private applySummary(row: Record<string, unknown> | undefined, summaryAtMs: number): void {
    this.dbNextRunAtMs = numOrNull(row?.nextRunAtMs);
    // Hints older than the summary are covered by it (their rows were committed before the kick).
    this.hints = this.hints.filter((h) => h.receivedAtMs >= summaryAtMs);
    if (row) {
      const gauges = {
        depth: { "80+": num(row.depthHi), "<80": num(row.depthLo) },
        oldestSec: { "80+": Math.round(num(row.oldestHiSec)), "<80": Math.round(num(row.oldestLoSec)) },
        seenAtMs: summaryAtMs,
      };
      this.opts.metrics.setQueue(gauges);
      for (const band of ["80+", "<80"] as const) {
        this.opts.telemetry?.metric("gauge", "worker.queue.depth", gauges.depth[band], { band });
        this.opts.telemetry?.metric("gauge", "worker.queue.oldest_s", gauges.oldestSec[band], { band });
      }
    }
  }

  private computeNext(): number | null {
    let next = this.dbNextRunAtMs;
    if (this.orphanCheckAtMs !== null) next = next === null ? this.orphanCheckAtMs : Math.min(next, this.orphanCheckAtMs);
    for (const h of this.hints) next = next === null ? h.atMs : Math.min(next, h.atMs);
    return next;
  }

  private delayFor(claimedLastDrain: number): number {
    const now = this.opts.clock.now();
    const next = this.computeNext();
    if (next === null) return this.maxSleepMs;
    let delay = next - now;
    if (delay <= 0) {
      if (this.held) return this.maxSleepMs;
      if (claimedLastDrain > 0) {
        this.dueFloorMs = DUE_FLOOR_MS;
        return 0;
      }
      // Due but nothing claimable (a row briefly locked by another worker): back off instead of spinning.
      delay = this.dueFloorMs;
      this.dueFloorMs = Math.min(this.dueFloorMs * 2, DUE_FLOOR_MAX_MS);
      return delay;
    }
    this.dueFloorMs = DUE_FLOOR_MS;
    return Math.min(delay, this.maxSleepMs);
  }

  private sleep(claimedLastDrain: number): Promise<void> {
    const delay = this.delayFor(claimedLastDrain);
    if (delay === 0 || this.stopping) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.sleeping = { resolve, timer: null };
      this.arm(delay);
    });
  }

  private arm(delay: number): void {
    const s = this.sleeping;
    if (!s) return;
    this.opts.clock.clearTimeout(s.timer);
    s.timer = this.opts.clock.setTimeout(() => this.wakeUp(), Math.max(0, delay));
  }

  /** A kick shortened the next run time: re-arm the current sleep. */
  private rearm(): void {
    if (!this.sleeping) return;
    const next = this.computeNext();
    if (next === null) return;
    this.arm(Math.min(Math.max(0, next - this.opts.clock.now()), this.maxSleepMs));
  }

  private wakeUp(): void {
    const s = this.sleeping;
    if (!s) return;
    this.sleeping = null;
    this.opts.clock.clearTimeout(s.timer);
    s.resolve();
  }

  private iso(ms: number | null): string | null {
    return ms === null ? null : new Date(ms).toISOString();
  }
}
