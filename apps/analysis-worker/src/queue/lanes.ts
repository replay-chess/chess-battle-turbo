// The I/O lane (phase-04 plan §7.7.1; interface check §0.6, §5). P3 runs one engine lane (scheduler.ts) that claims
// the analysis kinds. P4 adds, in the same process, an I/O lane with concurrency 2 that claims only the import kinds
// (IMPORT_SYNC, IMPORT_PURGE), so an import never waits behind an analysis and Stockfish never waits behind a slow
// provider. Both lanes use P3's claim statement unchanged; the kinds list is what separates them.
//
// Lock identity per slot. P3's claim retry form adopts "a RUNNING row locked by me" (claim.ts): a lane slot that
// shared the engine's `lockedBy` would adopt the other lane's running job after a lost claim response. So every slot
// claims, heart-beats, fails, releases and finishes as its own id, `<workerId>-<first 6 chars of the boot id>i<k>`:
//
//   - exactly 8 characters after `<workerId>-`, so P3's orphan pattern (`<workerId>-________`) still matches it and
//     a crashed boot's slot rows are reaped like its engine rows;
//   - `i` is never in the hex boot id, so a slot id never equals the engine's `me`;
//   - ≤ 39 characters (WORKER_ID ≤ 30), inside `jobs."lockedBy"` varchar(40);
//   - this boot's other ids are passed to the reaper as `alsoMine` (outcome.ts), so neither lane ever treats a live
//     sibling slot of its own boot as an orphan; only the 3-minute stale rule can reap a slot that stopped beating.
//
// Each slot keeps its own `known` list (the rows a claim handed it since its last drain-end reap, never adopted by
// the claim's retry form). The lane sleeps like P3's scheduler: no polling. It drains (each idle slot claims and runs
// until nothing is due), then ONE batch: a drain-end reap per slot + the queue summary of the import kinds, whose
// `min("runAt")` is the next wake: a daily sync rescheduled to HH:05 (outcome.ts rescheduleStatement) needs no timer
// of its own and no extra query (D4-27). A kick that names an import kind (or no kind) wakes it; IMPORT_PAUSED leaves
// the lane without kinds, so it claims nothing and costs nothing.
import type { KickBodyV1, KickResponse } from "@repo/contracts/internal/kick";
import { P4_JOB_KINDS, type JobKind } from "@repo/contracts/internal/jobs";
import type { Db } from "../db/client";
import type { Logger } from "../obs/log";
import type { Metrics } from "../obs/metrics";
import type { ProductEvents } from "../obs/posthog";
import type { Clock, TimerHandle } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";
import { claimJob, type ClaimedJob } from "./claim";
import { reapStatement, type FailedJob } from "./outcome";
import { handleReaped } from "./reaper";
import { queueSummaryStatement } from "./summary";

/** The I/O lane's concurrency (§7.7.1). */
export const IO_LANE_CONCURRENCY = 2;
/** The kinds the I/O lane claims; the engine lane never claims them. */
export const IO_KINDS: readonly JobKind[] = P4_JOB_KINDS;
/** The longest sleep (same as the engine lane: DAILY_PLAN keeps a row inside every 24 h anyway). */
export const IO_MAX_SLEEP_MS = 24 * 60 * 60 * 1000;
/** After a database error in the lane's loop, try again after this long (a kick still wakes it). */
export const IO_ERROR_RETRY_MS = 30_000;
const DUE_FLOOR_MS = 1_000;
const DUE_FLOOR_MAX_MS = 60_000;

/**
 * The lock id of I/O slot `k` (1-based) of the boot whose engine id is `me` = `<workerId>-<bootId>`. The boot id is
 * 8 characters; the slot id keeps its first 6 and appends `i<k>`.
 */
export function ioSlotId(me: string, k: number): string {
  const dash = me.lastIndexOf("-");
  const workerId = me.slice(0, dash);
  const bootId = me.slice(dash + 1);
  if (dash <= 0 || bootId.length !== 8) throw new Error("the worker's lock id must be <workerId>-<8-char boot id>");
  if (!Number.isInteger(k) || k < 1 || k > 9) throw new RangeError("an I/O slot number is 1..9");
  return `${workerId}-${bootId.slice(0, 6)}i${k}`;
}

/** Every lock id of this boot: the engine lane's `me` and the I/O slots. */
export function bootLockIds(me: string, concurrency = IO_LANE_CONCURRENCY): string[] {
  return [me, ...Array.from({ length: concurrency }, (_, i) => ioSlotId(me, i + 1))];
}

/** Whether a kick concerns the engine lane, the I/O lane, or both (no `kinds` = both). */
export function kickTargets(body: Pick<KickBodyV1, "kinds">): { engine: boolean; io: boolean } {
  const kinds = body.kinds as readonly string[] | undefined;
  if (!kinds || kinds.length === 0) return { engine: true, io: true };
  const io = kinds.some((k) => (IO_KINDS as readonly string[]).includes(k));
  const engine = kinds.some((k) => !(IO_KINDS as readonly string[]).includes(k));
  return { engine, io };
}

interface KickSink {
  kick(body: KickBodyV1): KickResponse;
}

/** Routes a kick to the lanes it names and merges their answers (the earliest next run, draining if either is). */
export function routeKick(body: KickBodyV1, engine: KickSink, io: KickSink | null): KickResponse {
  const t = kickTargets(body);
  const answers: KickResponse[] = [];
  if (t.engine || !io) answers.push(engine.kick(body));
  if (t.io && io) answers.push(io.kick(body));
  const next = answers
    .map((a) => (a.nextRunAt ? Date.parse(a.nextRunAt) : null))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)[0];
  return {
    draining: answers.some((a) => a.draining),
    nextRunAt: next === undefined ? null : new Date(next).toISOString(),
  };
}

export interface IoLaneOptions {
  db: Db;
  clock: Clock;
  log: Logger;
  metrics: Metrics;
  emitter: EmitSink;
  /** The engine lane's lock id of this boot (`<workerId>-<bootId>`). */
  me: string;
  workerId: string;
  /** The import kinds that have a handler; empty (IMPORT_PAUSED) = the lane claims nothing. */
  kinds: readonly JobKind[];
  payloadVMax: number;
  concurrency?: number;
  /** Runs one claimed job to its outcome as `slotMe` (jobs/runner.ts with `me` = the slot id). */
  runJob(job: ClaimedJob, slotMe: string, stopSignal: AbortSignal): Promise<unknown>;
  maxSleepMs?: number;
  events?: ProductEvents;
  /** After the drain-end reap: the kinds' own follow-up for reaped rows (an import run the reaper ended for good). */
  onReaped?(jobs: readonly FailedJob[]): Promise<void>;
}

interface Slot {
  me: string;
  busy: boolean;
  /** Rows a claim handed this slot since the lane's last drain-end reap (never adopted by the claim retry form). */
  readonly handedOut: Set<string>;
}

export interface IoLaneView {
  paused: boolean;
  busySlots: number;
  nextRunAtMs: number | null;
  lastDrainAtMs: number | null;
}

export class IoLane {
  readonly slots: Slot[];
  private stopping = false;
  private started = false;
  private drainEndInFlight = false;
  private wantsDrain = false;
  private dbNextRunAtMs: number | null = null;
  private hints: { atMs: number; receivedAtMs: number }[] = [];
  private lastDrainAtMs: number | null = null;
  private dueFloorMs = DUE_FLOOR_MS;
  private claimedThisRound = 0;
  private timer: TimerHandle | null = null;
  private readonly stopController = new AbortController();
  private idle: Promise<void> = Promise.resolve();
  private resolveIdle: (() => void) | null = null;
  private readonly maxSleepMs: number;
  /** Every lock id of this boot (engine + slots): the reaper never takes a sibling's row as an orphan. */
  readonly bootIds: readonly string[];

  constructor(private readonly opts: IoLaneOptions) {
    const n = opts.concurrency ?? IO_LANE_CONCURRENCY;
    this.bootIds = bootLockIds(opts.me, n);
    this.slots = this.bootIds.slice(1).map((me) => ({ me, busy: false, handedOut: new Set<string>() }));
    this.maxSleepMs = opts.maxSleepMs ?? IO_MAX_SLEEP_MS;
  }

  get paused(): boolean {
    return this.opts.kinds.length === 0;
  }

  get stopSignal(): AbortSignal {
    return this.stopController.signal;
  }

  /** The first drain (picks up what is due at boot). A paused lane does nothing, ever. */
  start(): void {
    if (this.paused) {
      this.opts.log.warn("I/O lane idle: no import kind to claim (IMPORT_PAUSED, or no import handler in this build)");
      return;
    }
    this.started = true;
    this.wake();
  }

  /** SIGTERM: stop claiming; running imports stop at their next safe point and release their jobs. */
  async stop(graceMs: number): Promise<void> {
    this.stopping = true;
    this.stopController.abort("stop");
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
    const grace = new AbortController();
    await Promise.race([this.idle, this.opts.clock.sleep(graceMs, grace.signal)]);
    grace.abort();
  }

  kick(body: KickBodyV1): KickResponse {
    const now = this.opts.clock.now();
    if (this.paused || this.stopping || !this.started) return { draining: false, nextRunAt: this.iso(this.computeNext()) };
    let wakeNow = true;
    if (body.runAt) {
      const at = Date.parse(body.runAt);
      this.hints.push({ atMs: at, receivedAtMs: now });
      if (at > now + 1_000) wakeNow = false;
    }
    if (wakeNow) this.wake();
    else this.arm();
    return { draining: this.busy || wakeNow, nextRunAt: this.iso(this.computeNext()) };
  }

  view(): IoLaneView {
    return {
      paused: this.paused,
      busySlots: this.slots.filter((s) => s.busy).length,
      nextRunAtMs: this.computeNext(),
      lastDrainAtMs: this.lastDrainAtMs,
    };
  }

  private get busy(): boolean {
    return this.slots.some((s) => s.busy) || this.drainEndInFlight;
  }

  /** Starts every idle slot (unless the drain-end batch is in flight: it reaps the slots as idle). */
  private wake(): void {
    if (this.stopping || this.paused) return;
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.drainEndInFlight) {
      this.wantsDrain = true;
      return;
    }
    for (const slot of this.slots) if (!slot.busy) this.startSlot(slot);
  }

  private startSlot(slot: Slot): void {
    slot.busy = true;
    if (!this.resolveIdle) this.idle = new Promise<void>((r) => (this.resolveIdle = r));
    void this.slotLoop(slot)
      .catch((error: unknown) => {
        this.opts.log.error("I/O lane slot failed", { slot: slot.me, error });
        this.dbNextRunAtMs = this.opts.clock.now() + IO_ERROR_RETRY_MS;
      })
      .finally(() => {
        slot.busy = false;
        if (!this.slots.some((s) => s.busy)) void this.drainEnd();
      });
  }

  private async slotLoop(slot: Slot): Promise<void> {
    while (!this.stopping) {
      const job = await claimJob(this.opts.db, slot.me, this.opts.kinds, this.opts.payloadVMax, [...slot.handedOut]);
      if (!job) return;
      slot.handedOut.add(job.id);
      this.claimedThisRound++;
      await this.opts.runJob(job, slot.me, this.stopController.signal);
    }
  }

  /** Every slot is idle: one batch with a drain-end reap per slot and the queue summary; then sleep or drain again. */
  private async drainEnd(): Promise<void> {
    if (this.drainEndInFlight) return;
    if (this.stopping) return this.settle();
    this.drainEndInFlight = true;
    const claimed = this.claimedThisRound;
    this.claimedThisRound = 0;
    try {
      const summaryAtMs = this.opts.clock.now();
      const out = await this.opts.db.batch([
        ...this.slots.map((s) =>
          reapStatement({
            workerId: this.opts.workerId,
            me: s.me,
            drainEnd: true,
            alsoMine: this.bootIds.filter((id) => id !== s.me),
          }),
        ),
        queueSummaryStatement(this.opts.kinds, this.opts.payloadVMax),
      ]);
      for (const s of this.slots) s.handedOut.clear();
      const reaped = out.slice(0, this.slots.length).flat();
      const jobs = await handleReaped(reaped, this.opts);
      if (jobs.length > 0 && this.opts.onReaped) {
        await this.opts.onReaped(jobs).catch((error: unknown) => this.opts.log.error("I/O lane reap hook failed", { error }));
      }
      const row = out[this.slots.length]?.[0];
      this.dbNextRunAtMs = row && row.nextRunAtMs !== null && row.nextRunAtMs !== undefined ? Number(row.nextRunAtMs) : null;
      this.hints = this.hints.filter((h) => h.receivedAtMs >= summaryAtMs);
    } catch (error) {
      this.opts.log.error("I/O lane drain end failed", { error });
      this.dbNextRunAtMs = this.opts.clock.now() + IO_ERROR_RETRY_MS;
      this.hints = [];
    } finally {
      this.drainEndInFlight = false;
      this.lastDrainAtMs = this.opts.clock.now();
    }
    if (this.stopping) return this.settle();
    if (this.wantsDrain) {
      this.wantsDrain = false;
      this.wake();
      return;
    }
    this.sleep(claimed);
  }

  private settle(): void {
    if (this.slots.some((s) => s.busy) || this.drainEndInFlight) return;
    this.resolveIdle?.();
    this.resolveIdle = null;
  }

  private sleep(claimedLastDrain: number): void {
    const now = this.opts.clock.now();
    const next = this.computeNext();
    let delay: number;
    if (next === null) delay = this.maxSleepMs;
    else if (next - now > 0) {
      this.dueFloorMs = DUE_FLOOR_MS;
      delay = Math.min(next - now, this.maxSleepMs);
    } else if (claimedLastDrain > 0) {
      this.dueFloorMs = DUE_FLOOR_MS;
      delay = 0;
    } else {
      // Due but nothing claimable (a row briefly locked by another worker): back off instead of spinning.
      delay = this.dueFloorMs;
      this.dueFloorMs = Math.min(this.dueFloorMs * 2, DUE_FLOOR_MAX_MS);
    }
    this.settle();
    this.arm(delay);
  }

  /** (Re)arms the one lane timer for `delay`, or for the next known run time. */
  private arm(delay?: number): void {
    if (this.stopping || this.busy) return;
    const ms = delay ?? (() => {
      const next = this.computeNext();
      return next === null ? this.maxSleepMs : Math.min(Math.max(0, next - this.opts.clock.now()), this.maxSleepMs);
    })();
    this.opts.clock.clearTimeout(this.timer);
    this.timer = this.opts.clock.setTimeout(() => {
      this.timer = null;
      this.wake();
    }, ms);
  }

  private computeNext(): number | null {
    let next = this.dbNextRunAtMs;
    for (const h of this.hints) next = next === null ? h.atMs : Math.min(next, h.atMs);
    return next;
  }

  private iso(ms: number | null): string | null {
    return ms === null ? null : new Date(ms).toISOString();
  }
}
