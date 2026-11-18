// A member's Weakness Profile built by the product's own pipelines, on a real Postgres (phase-06 plan §12.3; the
// owner's "real data, not mocks" rule, interface check §0.20, §9). Nothing is hand-written into the tables the
// profile reads:
//
//   link → IMPORT_SYNC (the real P4 handler, its real provider clients, the in-process upstream mock serving the CC0
//   fixture accounts: real Lichess games with their %clk clocks and %eval evaluations, the Chess.com fixture games)
//   → ANALYZE_GAME (the real P3 pipeline through SqlAnalysisStore with P5's J1 bank extraction and P6's final-batch
//   extension; the FakeEngine, or the real Stockfish 18 with WEAKNESS_INT_ENGINE=stockfish + ENGINE_PATH)
//   → RECOMPUTE_WEAKNESS (the handler under test) → HOUSEKEEPING (the daily slice).
//
// The upstream mock and the fake engine are the only fakes (the allowed outside parties). Fixture writes that the
// product makes elsewhere (the member row with its entitlement, the link row the web's link service writes, the run
// the web's import start writes) are made as the database owner, exactly as the import suites do.
import { existsSync } from "node:fs";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { JOB_PRIORITY, type JobKind } from "@repo/contracts/internal/jobs";
import { enqueueWeaknessSql } from "@repo/db/weakness-jobs";
import { fromPrisma, stmt, type CountingDb, type Row } from "../db/client";
import { EnginePool, engineFactory, type Engine } from "../engine";
import { FakeEngine } from "../engine/fake";
import { MistakesAddedCoalescer } from "../extract/coalesce";
import { DAY_MS, ImportWorld, recordingDriver, type MemberKind } from "../import/__tests__/harness";
import { defaultHandlers, type HandlerMap } from "../jobs";
import { runJob, type RunResult } from "../jobs/runner";
import { silentLogger } from "../obs/log";
import { BatchAccumulator } from "../pipeline/batch-events";
import { OpeningBook } from "../pipeline/openings";
import { SqlAnalysisStore } from "../pipeline/sql-store";
import { claimJob, NOW, toClaimedJob, type ClaimedJob } from "../queue/claim";
import type { WorkerEnv } from "../config/env";
import { WeaknessProgressEmitter } from "../weakness/progressEmitter";
import { defaultWeaknessSettings, type WeaknessSettings } from "../weakness/settings";
import type { IntEnv, TestUser } from "./pg";

export { DAY_MS };

let tagSeq = 0;
/** A digits-only upstream tag unique to this process and call (game external ids must never collide across runs). */
export function worldTag(): string {
  return `${String(Date.now()).slice(-7)}${String(process.pid % 100).padStart(2, "0")}${String(++tagSeq % 100).padStart(2, "0")}`.slice(-12);
}

/** The lock id this world claims and runs as (`<workerId>-<8 chars>`). */
export const WORLD_ME = "int-weak-00000001";

export interface WorldOptions {
  /** Overrides of the weakness settings (kill switch, caps, seed freeze). */
  weakness?: Partial<WeaknessSettings>;
  /** P4 settings (eager budgets). */
  imports?: ConstructorParameters<typeof ImportWorld>[2];
  /** The APP_ENV the jobs run under (the production refusal tests). */
  appEnv?: "test" | "production";
  /** A baseline id other than the default (the failure tests use an unknown one). */
  baselineId?: string;
  /** J1 bank extraction (default on: the examples come from its mistakes). */
  bank?: boolean;
}

/** WEAKNESS_INT_ENGINE=stockfish (+ ENGINE_PATH) runs the analyses with the real Stockfish 18 instead of the fake. */
export function intEngineFactory(): { factory: () => Engine; kind: "fake" | "stockfish" } {
  const knobs: Readonly<Record<string, string | undefined>> = process.env;
  if (knobs.WEAKNESS_INT_ENGINE === "stockfish") {
    const path = knobs.ENGINE_PATH;
    if (!path || !existsSync(path)) throw new Error("WEAKNESS_INT_ENGINE=stockfish needs ENGINE_PATH (the pinned Stockfish 18 binary)");
    const env = {
      engine: { kind: "stockfish", path, threads: ENGINE_PROFILE.threads, hashMb: ENGINE_PROFILE.hashMb, profile: ENGINE_PROFILE.id, nice: false },
    } as Pick<WorkerEnv, "engine"> as WorkerEnv;
    return { factory: engineFactory(env, silentLogger), kind: "stockfish" };
  }
  return { factory: () => new FakeEngine(), kind: "fake" };
}

export class WeaknessWorld {
  readonly imp: ImportWorld;
  readonly settings: WeaknessSettings;
  readonly progress: WeaknessProgressEmitter;
  readonly engine: EnginePool;
  readonly engineKind: "fake" | "stockfish";
  readonly handlers: HandlerMap;
  readonly db: CountingDb;
  readonly driver: ReturnType<typeof recordingDriver>;
  /** Every I/O-lane wake a job asked for (the runAt it named, or null for "now"). */
  readonly ioWakes: (number | null)[] = [];
  engineWakes = 0;
  private started = false;

  constructor(
    readonly env: IntEnv,
    tag: string,
    private readonly opts: WorldOptions = {},
  ) {
    this.imp = new ImportWorld(env, tag, opts.imports ?? {});
    this.driver = this.imp.driver;
    this.db = this.imp.db;
    this.settings = defaultWeaknessSettings(opts.weakness ?? {});
    const { factory, kind } = intEngineFactory();
    this.engineKind = kind;
    this.engine = new EnginePool({ factory, log: silentLogger, metrics: this.imp.metrics });
    this.progress = new WeaknessProgressEmitter({
      db: this.db,
      emitter: this.imp.emitter,
      clock: this.imp.clock,
      log: silentLogger,
      settings: this.settings,
      wakeIo: () => void this.ioWakes.push(null),
    });
    const store = new SqlAnalysisStore(this.db, { training: opts.bank !== false, weakness: this.settings.enabled });
    const batch = new BatchAccumulator({ emitter: this.imp.emitter, clock: this.imp.clock, log: silentLogger, queuedFor: (r) => store.queuedFor(r) });
    const weakness = { settings: this.settings, progress: this.progress, ...(opts.baselineId ? { baselineId: opts.baselineId } : {}) };
    this.handlers = defaultHandlers({
      store,
      book: new OpeningBook(() => store.openings(), silentLogger),
      batch,
      events: this.imp.product,
      imports: { providers: this.imp.providers, settings: this.imp.settings, events: this.imp.product, weakness },
      bank: { enabled: opts.bank !== false, lineNodes: 20_000 },
      mistakesAdded: new MistakesAddedCoalescer({ emitter: this.imp.emitter, clock: this.imp.clock, log: silentLogger }),
      weakness,
    });
  }

  get clock() {
    return this.imp.clock;
  }

  /** Moves the world's clock forward to `ms` (the FakeClock only goes forward). */
  async at(ms: number): Promise<void> {
    const delta = ms - this.clock.now();
    if (delta < 0) throw new Error("the world's clock only moves forward");
    await this.clock.advance(delta);
  }

  get emitter() {
    return this.imp.emitter;
  }

  get product() {
    return this.imp.product;
  }

  get telemetry() {
    return this.imp.telemetry;
  }

  async close(): Promise<void> {
    if (this.started) await this.engine.stop().catch(() => undefined);
    await this.imp.close();
  }

  // ── members and imports ────────────────────────────────────────────────────────────────────────────────────────
  member(kind: MemberKind, label: string, timeZone = "Asia/Kolkata"): Promise<TestUser> {
    return this.imp.member(kind, label, timeZone);
  }

  /** Links an account the upstream serves and runs its INITIAL import to the end (the real IMPORT_SYNC). */
  async importAccount(user: TestUser, provider: "CHESSCOM" | "LICHESS", username: string): Promise<void> {
    const link = await this.imp.link(user, provider, username, { autoImport: false });
    const run = await this.imp.run(user, link, provider, "INITIAL");
    const job = await this.imp.job(link, run.id, "INITIAL");
    for (let i = 0; i < 20; i++) {
      const claimed = await this.claim(["IMPORT_SYNC"]);
      if (!claimed) break;
      const out = await this.runClaimed(claimed);
      if (out === "done") {
        const row = (await this.q(`SELECT status::text AS status FROM ${this.env.schema}.jobs WHERE id = $1`, [job]))[0];
        if (row?.status === "DONE") return;
      }
    }
    const runRow = (await this.q(`SELECT status::text AS status FROM import_runs WHERE id = $1`, [run.id]))[0];
    if (runRow?.status !== "DONE") throw new Error(`the import of ${username} did not finish (${String(runRow?.status)})`);
  }

  // ── running jobs ───────────────────────────────────────────────────────────────────────────────────────────────
  claim(kinds: readonly JobKind[]): Promise<ClaimedJob | null> {
    return claimJob(this.db, WORLD_ME, kinds, 1);
  }

  async runClaimed(job: ClaimedJob, opts: { me?: string } = {}): Promise<RunResult> {
    if (!this.started) {
      await this.engine.start();
      this.started = true;
    }
    return runJob(job, {
      db: this.db,
      clock: this.clock,
      log: silentLogger,
      metrics: this.imp.metrics,
      telemetry: this.telemetry,
      emitter: this.emitter,
      me: opts.me ?? WORLD_ME,
      appEnv: this.opts.appEnv ?? "test",
      handlers: this.handlers,
      engine: this.engine,
      evalCache: null,
      evalCacheMaxBytes: 0,
      lag: null,
      stopSignal: new AbortController().signal,
      isWatched: () => false,
      takeFault: () => null,
      wakeEngine: () => void this.engineWakes++,
      wakeIo: (runAtMs?: number) => void this.ioWakes.push(runAtMs ?? null),
    });
  }

  /** Makes every QUEUED job of `kinds` (optionally one user's) due now. */
  async due(kinds: readonly JobKind[], userId?: string): Promise<void> {
    await this.env.owner.query(
      `UPDATE ${this.env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second'
        WHERE status = 'QUEUED' AND kind::text = ANY($1::text[]) AND ($2::bigint IS NULL OR "userId" = $2::bigint
              OR ("gameId" IS NOT NULL AND "gameId" IN (SELECT "gameId" FROM game_players WHERE "userId" = $2::bigint)))`,
      [[...kinds], userId ?? null],
    );
  }

  /** Runs every due ANALYZE_GAME (the engine lane), at most `max`; returns how many ran. */
  async drainAnalyses(max = 500): Promise<number> {
    let n = 0;
    for (; n < max; n++) {
      const job = await this.claim(["ANALYZE_GAME"]);
      if (!job) break;
      const out = await this.runClaimed(job);
      if (out !== "done") throw new Error(`ANALYZE_GAME ${job.id} ended ${out}`);
    }
    return n;
  }

  /** Claims and runs the member's RECOMPUTE_WEAKNESS row (made due first). */
  async recompute(userId: string, opts: { me?: string } = {}): Promise<{ job: ClaimedJob; out: RunResult }> {
    await this.env.owner.query(
      `UPDATE ${this.env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second'
        WHERE "dedupeKey" = 'weakness:' || $1::text AND status = 'QUEUED'`,
      [userId],
    );
    const job = await this.claimRow(`weakness:${userId}`, opts.me ?? WORLD_ME);
    if (!job) throw new Error(`no RECOMPUTE_WEAKNESS row is due for user ${userId}`);
    return { job, out: await this.runClaimed(job, opts) };
  }

  /**
   * The claim statement's own update for ONE row (by dedupe key) instead of the queue's next: other members' rows of
   * this private schema (an import's `import` trigger, a first build) stay where they are. Same columns and stamps as
   * queue/claim.ts.
   */
  claimRow(dedupeKey: string, me = WORLD_ME): Promise<ClaimedJob | null> {
    return this.claimWhere(`"dedupeKey" = $1`, [dedupeKey], me);
  }

  /** The next due ANALYZE_GAME of one member's games (the queue's order), other members' jobs left alone. */
  claimAnalysisOf(userId: string, me = WORLD_ME): Promise<ClaimedJob | null> {
    return this.claimWhere(
      `kind = 'ANALYZE_GAME' AND "gameId" IN (SELECT "gameId" FROM game_players WHERE "userId" = $1::bigint)`,
      [userId],
      me,
    );
  }

  /** Runs every due ANALYZE_GAME of one member; returns how many ran. */
  async drainAnalysesOf(userId: string, max = 500): Promise<number> {
    let n = 0;
    for (; n < max; n++) {
      const job = await this.claimAnalysisOf(userId);
      if (!job) break;
      const out = await this.runClaimed(job);
      if (out !== "done") throw new Error(`ANALYZE_GAME ${job.id} ended ${out}`);
    }
    return n;
  }

  private async claimWhere(where: string, values: unknown[], me: string): Promise<ClaimedJob | null> {
    const lockParam = `$${values.length + 1}`;
    const rows = await this.db.query(
      stmt(
        `UPDATE jobs
            SET status = 'RUNNING', "lockedBy" = ${lockParam}, "lockedAt" = ${NOW}, "heartbeatAt" = ${NOW},
                "startedAt" = COALESCE("startedAt", ${NOW}), attempts = attempts + 1
          WHERE id = (SELECT id FROM jobs WHERE ${where} AND status = 'QUEUED' AND "runAt" <= ${NOW}
                       ORDER BY priority DESC, "fairSeq", "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id::text AS id, kind::text AS kind, payload, attempts, "maxAttempts", priority, "gameId"::text AS "gameId",
                "userId"::text AS "userId", (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
                (extract(epoch FROM "createdAt") * 1000)::float8 AS "createdAtMs",
                (extract(epoch FROM "lockedAt") * 1000)::float8 AS "claimedAtMs"`,
        [...values, me],
      ),
    );
    return rows[0] ? toClaimedJob(rows[0]) : null;
  }

  /** Arms a member's recompute the way TR-12 does (USER_OPENED, now), through the shared upsert. */
  async arm(userId: string, trigger: "user" | "first_build" | "weekly" = "user"): Promise<void> {
    await this.db.query(
      fromPrisma(enqueueWeaknessSql({ userId: BigInt(userId), trigger, priority: JOB_PRIORITY.USER_OPENED, runAt: new Date(Date.now() - 1_000), debounceSec: 0 })),
    );
  }

  // ── reading back (as the owner) ─────────────────────────────────────────────────────────────────────────────────
  async q<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.env.owner.query(text, values)).rows as T[];
  }

  /** The member's snapshots, newest first. */
  snapshots(userId: string) {
    return this.q<{ weekStart: string; status: string; algoVersion: number; gamesInScope: number; gamesAnalysed: number; metrics: Record<string, unknown>; headline: string | null }>(
      `SELECT to_char("weekStart", 'YYYY-MM-DD') AS "weekStart", status::text AS status, "algoVersion", "gamesInScope",
              "gamesAnalysed", metrics, headline
         FROM ${this.env.schema}.weakness_snapshots WHERE "userId" = $1 ORDER BY "weekStart" DESC`,
      [userId],
    );
  }

  async weaknessVersion(userId: string): Promise<number> {
    const rows = await this.q<{ v: number }>(`SELECT "weaknessVersion" AS v FROM ${this.env.schema}.training_profiles WHERE "userId" = $1`, [userId]);
    return rows[0]?.v ?? 0;
  }

  async job(userId: string) {
    return (
      await this.q<{ id: string; status: string; priority: number; payload: Record<string, unknown>; runAtMs: number; finishedAtMs: number | null; attempts: number; result: Record<string, unknown> | null; lockedBy: string | null; lastError: string | null; nowMs: number }>(
        `SELECT id::text AS id, status::text AS status, priority, payload, (extract(epoch FROM "runAt") * 1000)::float8 AS "runAtMs",
                (extract(epoch FROM "finishedAt") * 1000)::float8 AS "finishedAtMs", attempts, result, "lockedBy", "lastError",
                (extract(epoch FROM (now() AT TIME ZONE 'UTC')) * 1000)::float8 AS "nowMs"
           FROM ${this.env.schema}.jobs WHERE "dedupeKey" = 'weakness:' || $1::text`,
        [userId],
      )
    )[0];
  }

  /** The member's analysed sides and their input columns. */
  inputs(userId: string) {
    return this.q<{ gameId: string; color: string; accuracy: number | null; stats: number[]; errorLog: number[]; errorThemeN: number[]; errorThemes: string[]; weaknessInputsV: number; timeClass: string | null }>(
      `SELECT "gameId"::text AS "gameId", color, accuracy, stats, "errorLog", "errorThemeN", "errorThemes", "weaknessInputsV",
              "timeClass"::text AS "timeClass"
         FROM game_players WHERE "userId" = $1 ORDER BY "endedAt" DESC, "gameId" DESC`,
      [userId],
    );
  }

  weaknessEvents(event: "weakness:ready" | "weakness:progress", userRef?: string) {
    return this.emitter.sent.filter((e) => e.event === event && (!userRef || e.userRefs.includes(userRef)));
  }
}
