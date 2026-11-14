// An in-memory `jobs` table behind the Driver interface, for the scheduler / runner / housekeeping unit tests (the
// timer audit counts round trips through CountingDb on top of it). It understands exactly the statements the worker
// core sends: the claim, the reaper, the queue summary, the plan inserts, the lock guard, done, fail, release and the
// heartbeat, and HOUSEKEEPING's set-based slice statements (the jobs prune runs on the fake rows; the shares and
// rate-limit prunes delete nothing here; the regrade search returns `outdated`; P4's import backstop requeues nothing
// and its parked-import release releases nothing: the fake has no linked accounts or import runs; P5's training
// hygiene changes nothing: the fake has no training tables). Anything else throws, so a new
// statement cannot slip past the tests unnoticed.
import type { Driver, Row, Statement } from "../db/client";

export interface FakeJob {
  id: string;
  kind: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  priority: number;
  fairSeq: number;
  runAtMs: number;
  createdAtMs: number;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  heartbeatAtMs: number | null;
  lastError: string | null;
  result: unknown;
  finishedAtMs: number | null;
}

export class FakeQueue implements Driver {
  readonly jobs: FakeJob[] = [];
  readonly log: string[] = [];
  /** Called after a statement of that kind ran (e.g. "summary"), to simulate a commit racing the worker. */
  readonly after = new Map<string, () => void>();
  /** The next N round trips throw (a database outage). */
  failNext = 0;
  /** What the regrade sweep's search returns (`{id, ref}` rows). */
  outdated: { id: string; ref: string }[] = [];
  /** What freshSiblingsStatement returns: RUNNING rows of another boot of this worker id still heart-beating. */
  siblings: { n: number; lastBeatMs: number | null } = { n: 0, lastBeatMs: null };
  /**
   * The game side of an ANALYZE_GAME fail write (the SQL marks the game FAILED and returns the members): when set,
   * a failed ANALYZE_GAME row carries its game's ref, plies, graded plies and members, so `analysis:failed` goes out.
   */
  gameOnFail:
    | ((gameId: string) => { ref: string; plyCount: number; gradedPlies: number; members: string[] } | null)
    | null = null;
  private seq = 1;

  constructor(private readonly now: () => number) {}

  add(j: Partial<FakeJob> & { kind: string }): FakeJob {
    const job: FakeJob = {
      id: String(this.seq++),
      status: "QUEUED",
      priority: 80,
      fairSeq: 0,
      runAtMs: this.now(),
      createdAtMs: this.now(),
      payload: { v: 1 },
      dedupeKey: null,
      attempts: 0,
      maxAttempts: 4,
      lockedBy: null,
      heartbeatAtMs: null,
      lastError: null,
      result: null,
      finishedAtMs: null,
      ...j,
    };
    this.jobs.push(job);
    return job;
  }

  byKind(kind: string): FakeJob[] {
    return this.jobs.filter((j) => j.kind === kind);
  }

  async run(ss: readonly Statement[], transaction: boolean): Promise<Row[][]> {
    if (this.failNext > 0) {
      this.failNext--;
      this.log.push("error");
      throw Object.assign(new Error("relation is unavailable"), { code: "XX000" });
    }
    const snapshot = transaction ? structuredClone(this.jobs) : null;
    try {
      return ss.map((s) => {
        const rows = this.one(s);
        const kind = this.log[this.log.length - 1]!;
        const hook = this.after.get(kind);
        if (hook) {
          this.after.delete(kind);
          hook();
        }
        return rows;
      });
    } catch (error) {
      if (snapshot) this.jobs.splice(0, this.jobs.length, ...snapshot);
      throw error;
    }
  }

  async close(): Promise<void> {}

  private one(s: Statement): Row[] {
    const t = s.text;
    const v = s.values;
    const now = this.now();
    if (t.includes(`SET status = 'RUNNING', "lockedBy" = $1`)) {
      this.log.push("claim");
      const kinds = v[1] as string[];
      const vmax = v[2] as number;
      const due = this.jobs
        .filter(
          (j) =>
            j.status === "QUEUED" &&
            j.runAtMs <= now &&
            kinds.includes(j.kind) &&
            (typeof j.payload.v === "number" ? j.payload.v : 1) <= vmax,
        )
        .sort((a, b) => b.priority - a.priority || a.fairSeq - b.fairSeq || a.runAtMs - b.runAtMs);
      const job = due[0];
      if (!job) return [];
      Object.assign(job, { status: "RUNNING", lockedBy: v[0], heartbeatAtMs: now, attempts: job.attempts + 1 });
      return [
        {
          id: job.id,
          kind: job.kind,
          payload: job.payload,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          priority: job.priority,
          gameId: null,
          userId: null,
          runAtMs: job.runAtMs,
          createdAtMs: job.createdAtMs,
          claimedAtMs: now,
        },
      ];
    }
    if (t.includes(`AS "lastBeatMs"`)) {
      // freshSiblingsStatement: rows of another boot of this worker id (`siblings`, set by a test).
      this.log.push("siblings");
      return [{ n: this.siblings.n, lastBeatMs: this.siblings.lastBeatMs }];
    }
    if (t.includes(`"lockedBy" LIKE $1 ESCAPE`)) {
      this.log.push("reap");
      return [];
    }
    if (t.includes(`AS "nextRunAtMs"`)) {
      this.log.push("summary");
      const kinds = v[0] as string[];
      const queued = this.jobs.filter((j) => j.status === "QUEUED" && kinds.includes(j.kind));
      const due = queued.filter((j) => j.runAtMs <= now);
      return [
        {
          nextRunAtMs: queued.length ? Math.min(...queued.map((j) => j.runAtMs)) : null,
          depthHi: due.filter((j) => j.priority >= 80).length,
          depthLo: due.filter((j) => j.priority < 80).length,
          oldestHiSec: 0,
          oldestLoSec: 0,
        },
      ];
    }
    if (t.startsWith("INSERT INTO jobs")) {
      this.log.push("insert");
      const [kind, priority, fairSeq, dedupeKey, , , payload] = v as [
        string,
        number,
        number,
        string | null,
        unknown,
        unknown,
        string,
      ];
      const runAtMs = v.length === 9 ? Date.parse(v[7] as string) : now;
      if (dedupeKey && this.jobs.some((j) => j.dedupeKey === dedupeKey)) return [];
      const job = this.add({
        kind,
        priority,
        fairSeq,
        dedupeKey,
        payload: JSON.parse(payload),
        runAtMs,
        maxAttempts: v[v.length - 1] as number,
      });
      return [{ id: job.id, status: job.status, priority, attempts: 0, runAtMs, created: true }];
    }
    if (t.includes("SELECT 1 / (SELECT count(*)")) {
      this.log.push("guard");
      const job = this.jobs.find((j) => j.id === v[0]);
      if (!job || job.lockedBy !== v[1] || job.status !== "RUNNING")
        throw Object.assign(new Error("division by zero"), { code: "22012" });
      return [{ held: 1 }];
    }
    const held = () => this.jobs.find((j) => j.id === v[0] && j.lockedBy === v[1] && j.status === "RUNNING");
    if (t.includes(`SET status = 'DONE'`)) {
      this.log.push("done");
      const job = held();
      if (!job) return [];
      Object.assign(job, {
        status: "DONE",
        finishedAtMs: now,
        result: v[2] === null ? null : JSON.parse(v[2] as string),
      });
      return [{ id: job.id }];
    }
    if (t.includes(`SET "heartbeatAt" = `) && !t.includes("WITH j AS")) {
      this.log.push("heartbeat");
      const job = held();
      if (!job) return [];
      job.heartbeatAtMs = now;
      return [{ priority: job.priority }];
    }
    if (t.includes(`WITH j AS`) && t.includes(`"lastError" = $3`)) {
      this.log.push("fail");
      const job = held();
      if (!job) return [];
      const terminal = job.attempts >= job.maxAttempts || v[4] === true;
      Object.assign(job, {
        status: terminal ? "FAILED" : "QUEUED",
        runAtMs: terminal ? job.runAtMs : now + (v[3] as number) * 1000,
        finishedAtMs: terminal ? now : null,
        lastError: v[2],
        lockedBy: null,
      });
      const gameId = job.kind === "ANALYZE_GAME" && typeof job.payload.gameId === "string" ? job.payload.gameId : null;
      const game = gameId && this.gameOnFail ? this.gameOnFail(gameId) : null;
      return [
        {
          id: job.id,
          kind: job.kind,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          gameId,
          runAtMs: job.runAtMs,
          gameRef: game?.ref ?? null,
          plyCount: game?.plyCount ?? null,
          gradedPlies: game?.gradedPlies ?? null,
          members: game?.members ?? [],
          bumped: game ? game.members.length : 0,
        },
      ];
    }
    if (t.includes(`attempts = GREATEST(attempts - 1, 0)`)) {
      this.log.push("release");
      const job = held();
      if (!job) return [];
      Object.assign(job, {
        status: "QUEUED",
        runAtMs: now + (v[2] as number) * 1000,
        attempts: Math.max(0, job.attempts - 1),
        lockedBy: null,
      });
      return [{ id: job.id, gamesRequeued: 0 }];
    }
    if (t.includes("DELETE FROM jobs WHERE id IN")) {
      this.log.push("prune-jobs");
      const day = 86_400_000;
      const gone = this.jobs.filter(
        (j) =>
          j.finishedAtMs !== null &&
          ((j.status === "DONE" && j.finishedAtMs < now - (v[0] as number) * day) ||
            ((j.status === "FAILED" || j.status === "CANCELLED") && j.finishedAtMs < now - (v[1] as number) * day)),
      );
      for (const j of gone) this.jobs.splice(this.jobs.indexOf(j), 1);
      return [{ deleted: gone.length }];
    }
    if (t.includes("DELETE FROM shares")) {
      this.log.push("prune-shares");
      return [{ deleted: 0 }];
    }
    if (t.includes("DELETE FROM rate_limit_buckets")) {
      this.log.push("prune-buckets");
      return [{ deleted: 0 }];
    }
    if (t.includes("DELETE FROM rate_limit_windows")) {
      this.log.push("prune-windows");
      return [{ deleted: 0 }];
    }
    if (t.includes("FROM game_analyses a JOIN games g")) {
      this.log.push("outdated");
      return this.outdated.slice(0, v[1] as number);
    }
    if (t.includes("FROM linked_accounts la") && t.includes("requeued")) {
      // P4's daily-sync backstop (recurring/import-backstop.ts): there are no linked accounts in the fake.
      this.log.push("import-backstop");
      return [{ requeued: 0 }];
    }
    if (t.includes("WAITING_FOR_MEMBERSHIP") && t.includes("released")) {
      // FIX-1's parked-import release (recurring/import-backstop.ts): there are no import runs in the fake.
      this.log.push("import-release");
      return [{ released: 0, accounts: 0, queued: 0 }];
    }
    // P5's training hygiene (recurring/training-hygiene.ts): the fake has no training tables.
    if (t.includes("UPDATE training_sessions SET status = 'ABANDONED'")) {
      this.log.push("training-abandon");
      return [{ abandoned: 0 }];
    }
    if (t.includes("UPDATE training_days SET plan = NULL")) {
      this.log.push("training-plans");
      return [{ cleared: 0 }];
    }
    if (t.includes("DELETE FROM training_sessions")) {
      this.log.push("training-prune");
      return [{ deleted: 0 }];
    }
    throw new Error(`FakeQueue: unexpected statement: ${t.slice(0, 80)}`);
  }
}
