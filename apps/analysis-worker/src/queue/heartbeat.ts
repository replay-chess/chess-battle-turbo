// The job heartbeat (phase-03 plan §8.12 step 5): every checkpoint refreshes `jobs."heartbeatAt"` (noteWrite), and a
// timer heart-beats on its own when 30 s pass without a write, so a long pass-2 search never looks stalled (the
// reaper's limit is 3 minutes, A2's is 90 s). Each beat returns the job's current priority: an A3 that raised it
// mid-run switches the job into the streaming band at the next beat or checkpoint (P3-D26).
//
// A beat that finds the job no longer ours (reaped while we were stuck) calls onLost(): the runner aborts the job and
// writes nothing more.
import type { Db } from "../db/client";
import type { Logger } from "../obs/log";
import type { Clock, TimerHandle } from "../scheduler/clock";
import { heartbeatStatement } from "./outcome";

export const HEARTBEAT_EVERY_MS = 30_000;

export interface HeartbeatOptions {
  db: Db;
  clock: Clock;
  log: Logger;
  jobId: string;
  me: string;
  intervalMs?: number;
  onPriority?: (priority: number) => void;
  onLost: () => void;
}

export class Heartbeat {
  private timer: TimerHandle | null = null;
  private running = false;
  private suspended = false;
  private inFlight: Promise<number | null> | null = null;

  constructor(private readonly opts: HeartbeatOptions) {}

  start(): void {
    this.running = true;
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** The `stall_at_ply` fault: stop heart-beating (the job then looks stalled to A2 and the reaper). */
  suspend(): void {
    this.suspended = true;
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  /** A checkpoint (or any guarded write) just refreshed the heartbeat; `priority` is what it returned. */
  noteWrite(priority?: number): void {
    if (priority !== undefined) this.opts.onPriority?.(priority);
    this.arm();
  }

  /** Heart-beats now. Returns the job's priority, or null when the job is no longer ours (or the write failed). */
  beat(): Promise<number | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.send().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async send(): Promise<number | null> {
    try {
      const rows = await this.opts.db.query<{ priority: number | string }>(heartbeatStatement(this.opts.jobId, this.opts.me));
      if (!rows[0]) {
        this.opts.log.warn("heartbeat: the job is no longer ours", { jobId: this.opts.jobId });
        this.stop();
        this.opts.onLost();
        return null;
      }
      const priority = Number(rows[0].priority);
      this.noteWrite(priority);
      return priority;
    } catch (error) {
      // The next beat (or checkpoint) tries again; the reaper's 3-minute limit leaves room for a few misses.
      this.opts.log.warn("heartbeat failed", { jobId: this.opts.jobId, error });
      this.arm();
      return null;
    }
  }

  private arm(): void {
    if (!this.running || this.suspended) return;
    this.opts.clock.clearTimeout(this.timer);
    this.timer = this.opts.clock.setTimeout(() => {
      this.timer = null;
      void this.beat();
    }, this.opts.intervalMs ?? HEARTBEAT_EVERY_MS);
  }
}
