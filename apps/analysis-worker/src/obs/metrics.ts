// In-memory gauges and counters (phase-03 plan §10.2): served by `GET /internal/metrics` as WorkerMetricsResponse,
// with no database query. The queue gauges are what the last drain saw (`queueSeenAt`), because an idle worker
// never queries Neon.
//
// P4 (phase-04 plan §10.2): the import series (import/metrics.ts) ride along as `imports`, validated by their own
// schema. The contract's WorkerMetricsResponse does not declare them, so a reader that parses with it (the web's
// daily cron) simply drops them; the ops report reads them as they are.
import { PRIORITY_BANDS, type JobKind, type PriorityBand } from "@repo/contracts/internal/jobs";
import { WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import { ImportMetrics, ImportMetricsSnapshot } from "../import/metrics";

const DURATION_WINDOW = 100;
const FAIL_CODE = /^[a-z_]{1,32}$/;

export interface QueueGauges {
  depth: Record<PriorityBand, number>;
  oldestSec: Record<PriorityBand, number>;
  seenAtMs: number;
}

export interface SchedulerView {
  draining: boolean;
  nextRunAtMs: number | null;
  lastDrainAtMs: number | null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** What `GET /internal/metrics` serves: the P3 contract plus the P4 import series. */
export type WorkerMetricsBody = WorkerMetricsResponse & { imports: ImportMetricsSnapshot };

export class Metrics {
  readonly bootAtMs: number;
  private readonly done = new Map<JobKind, number>();
  private readonly failed = new Map<string, number>();
  private readonly durations = new Map<JobKind, number[]>();
  private readonly emits = new Map<string, number>();
  private queue: QueueGauges | null = null;
  lastHousekeepingAtMs: number | null = null;
  engineNps: number | null = null;
  engineRestarts = 0;
  cacheHitsMemory = 0;
  cacheHitsDisk = 0;
  cacheMisses = 0;
  dbStatements = 0;
  dbRetries = 0;
  lagPauseMs = 0;
  /** P4: the import series (§10.2). */
  readonly imports = new ImportMetrics();

  constructor(
    readonly identity: { workerId: string; bootId: string; version: string; profile: string },
    nowMs: number,
  ) {
    this.bootAtMs = nowMs;
  }

  jobDone(kind: JobKind, durationMs: number): void {
    this.done.set(kind, (this.done.get(kind) ?? 0) + 1);
    const window = this.durations.get(kind) ?? [];
    window.push(Math.max(0, Math.round(durationMs)));
    if (window.length > DURATION_WINDOW) window.shift();
    this.durations.set(kind, window);
  }

  jobFailed(code: string): void {
    const key = FAIL_CODE.test(code) ? code : "internal";
    this.failed.set(key, (this.failed.get(key) ?? 0) + 1);
  }

  emitted(event: string): void {
    this.emits.set(event, (this.emits.get(event) ?? 0) + 1);
  }

  setQueue(gauges: QueueGauges): void {
    this.queue = gauges;
  }

  get queueGauges(): QueueGauges | null {
    return this.queue;
  }

  snapshot(nowMs: number, scheduler: SchedulerView): WorkerMetricsBody {
    const zero = () => Object.fromEntries(PRIORITY_BANDS.map((b) => [b, 0])) as Record<PriorityBand, number>;
    const body: WorkerMetricsResponse = {
      v: 1,
      workerId: this.identity.workerId,
      bootId: this.identity.bootId,
      version: this.identity.version,
      profile: this.identity.profile,
      uptimeSec: Math.max(0, Math.floor((nowMs - this.bootAtMs) / 1000)),
      draining: scheduler.draining,
      nextRunAt: iso(scheduler.nextRunAtMs),
      lastDrainAt: iso(scheduler.lastDrainAtMs),
      lastHousekeepingAt: iso(this.lastHousekeepingAtMs),
      queue: {
        depth: this.queue?.depth ?? zero(),
        oldestSec: this.queue?.oldestSec ?? zero(),
        queueSeenAt: iso(this.queue?.seenAtMs ?? null),
      },
      jobs: {
        done: Object.fromEntries(this.done),
        failed: Object.fromEntries(this.failed),
        durationMsP50: Object.fromEntries([...this.durations].map(([k, v]) => [k, median(v)])),
      },
      engine: { nps: this.engineNps, restarts: this.engineRestarts },
      cache: { hitsMemory: this.cacheHitsMemory, hitsDisk: this.cacheHitsDisk, misses: this.cacheMisses },
      db: { statements: this.dbStatements, retries: this.dbRetries },
      lagPauseMs: Math.round(this.lagPauseMs),
      emits: Object.fromEntries(this.emits),
    };
    // A shape drift is a bug in this file: fail loudly in tests rather than serve a body the cron cannot read.
    return { ...WorkerMetricsResponse.parse(body), imports: ImportMetricsSnapshot.parse(this.imports.snapshot()) };
  }
}
