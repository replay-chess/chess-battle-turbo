// A whole worker around the ANALYZE_GAME / LEGEND_COMPARE handlers for the unit tests (phase-03 plan §12.1
// `pipeline`, `resume`, `failure`): FakeQueue jobs + the in-memory analysis store, the deterministic FakeEngine
// behind the real EnginePool (restart-and-retry, crash injection), a FakeClock (nothing happens until a test
// advances it), recording emitter / PostHog / Sentry, the real BatchAccumulator and OpeningBook, and runJob.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { EvalCache } from "../cache/evalcache";
import type { Fault } from "../config/faults";
import { CountingDb, type Driver } from "../db/client";
import { EnginePool, type Engine } from "../engine";
import { FakeEngine } from "../engine/fake";
import { legendCompareHandler } from "../jobs/legend-compare";
import { runJob, type HandlerMap, type RunResult } from "../jobs/runner";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { RecordingProductEvents } from "../obs/posthog";
import { RecordingTelemetry } from "../obs/telemetry";
import { analyzeGameHandler, type BankExtractSettings } from "../pipeline/analyze-game";
import { BatchAccumulator } from "../pipeline/batch-events";
import type { FinalBatchExtension } from "../pipeline/final-batch";
import { OpeningBook } from "../pipeline/openings";
import type { AnalysisStore, LegendCompareStore } from "../pipeline/store";
import type { OpeningRow } from "../pipeline/types";
import { claimJob } from "../queue/claim";
import { FakeClock } from "../scheduler/clock";
import { RecordingEmitter } from "../socket/emit";
import { FakeQueue, type FakeJob } from "./fake-queue";
import { MemoryAnalysisStore, type MemGameInit } from "./memory-store";

export const T0 = Date.UTC(2026, 10, 11, 18, 0, 0);
export const ME = "test-worker-00000001";

/** The Two Knights lines the design GAME runs through (book plies and the C59 opening name). */
export const TEST_OPENINGS: OpeningRow[] = [
  { eco: "C55", name: "Italian Game: Two Knights Defense", pgn: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6" },
  {
    eco: "C58",
    name: "Italian Game: Two Knights Defense, Polerio Defense",
    pgn: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5",
  },
  {
    eco: "C59",
    name: "Italian Game: Two Knights Defense, Polerio Defense, Suhle Defense",
    pgn: "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Na5 6. Bb5+ c6 7. dxc6 bxc6 8. Be2 h6",
  },
];

export interface HarnessOptions {
  /** A real eval cache in a temp dir (default: off, as for goldens). */
  cache?: boolean;
  engineFactory?: () => Engine;
  extensions?: FinalBatchExtension[];
  watched?: string[];
  fault?: Fault | null;
  /** Wrap or replace the store (change the job's priority after a checkpoint; the SQL store over `db`). */
  wrapStore?: (s: MemoryAnalysisStore, db: CountingDb) => AnalysisStore & LegendCompareStore;
  /** A driver under CountingDb instead of the FakeQueue (its job statements must still reach the queue). */
  driver?: (queue: FakeQueue) => Driver;
  /** P5 J1 (off when absent, as before P5). */
  bank?: BankExtractSettings;
}

export async function harness(o: HarnessOptions = {}) {
  const clock = new FakeClock(T0);
  const queue = new FakeQueue(() => clock.now());
  const db = new CountingDb(o.driver ? o.driver(queue) : queue);
  const memory = new MemoryAnalysisStore(queue, () => clock.now());
  memory.openingRows = TEST_OPENINGS;
  const store = o.wrapStore ? o.wrapStore(memory, db) : memory;
  const metrics = new Metrics({ workerId: ME, bootId: "00000001", version: "0", profile: "sf18-v1" }, T0);
  const emitter = new RecordingEmitter();
  const events = new RecordingProductEvents();
  const telemetry = new RecordingTelemetry();
  const engines: FakeEngine[] = [];
  const engine = new EnginePool({
    factory:
      o.engineFactory ??
      (() => {
        const e = new FakeEngine();
        engines.push(e);
        return e;
      }),
    log: silentLogger,
    metrics,
  });
  await engine.start();
  const evalCache = o.cache
    ? EvalCache.open({
        path: join(mkdtempSync(join(tmpdir(), "wk-pipe-")), "evals.sqlite"),
        log: silentLogger,
        metrics,
        nowMs: () => clock.now(),
      })
    : null;
  const batch = new BatchAccumulator({ emitter, clock, log: silentLogger, queuedFor: (refs) => store.queuedFor(refs) });
  const book = new OpeningBook(() => store.openings(), silentLogger);
  const handlers: HandlerMap = {
    ANALYZE_GAME: analyzeGameHandler({
      store,
      book,
      batch,
      events,
      ...(o.extensions ? { extensions: o.extensions } : {}),
      ...(o.bank ? { bank: o.bank } : {}),
    }),
    LEGEND_COMPARE: legendCompareHandler({ store }),
  };
  const watched = new Set(o.watched ?? []);
  let fault: Fault | null = o.fault ?? null;
  const stop = new AbortController();

  /** Queues an ANALYZE_GAME job for a game the store holds. */
  const enqueue = (gameId: string, ref: string, extra: Partial<FakeJob> & { reason?: string } = {}) =>
    queue.add({
      kind: "ANALYZE_GAME",
      priority: JOB_PRIORITY.GAME_ENDED,
      dedupeKey: `analyze:${gameId}`,
      payload: { v: 1, gameId, gameRef: ref, reason: extra.reason ?? "live_end" },
      ...extra,
    });

  /** Claims the next due job and runs it to its outcome. */
  const run = async (): Promise<RunResult | null> => {
    const job = await claimJob(db, ME, ["ANALYZE_GAME", "LEGEND_COMPARE"], 1);
    if (!job) return null;
    return runJob(job, {
      db,
      clock,
      log: silentLogger,
      metrics,
      telemetry,
      emitter,
      me: ME,
      appEnv: "test",
      handlers,
      engine,
      evalCache,
      evalCacheMaxBytes: 4 * 1024 ** 3,
      lag: null,
      stopSignal: stop.signal,
      isWatched: (ref) => watched.has(ref),
      takeFault: () => {
        const f = fault;
        fault = null;
        return f;
      },
    });
  };

  return {
    clock,
    queue,
    db,
    store: memory,
    metrics,
    emitter,
    events,
    telemetry,
    engine,
    engines,
    evalCache,
    batch,
    stop,
    watched,
    enqueue,
    run,
    setFault: (f: Fault | null) => {
      fault = f;
    },
    addGame: (g: MemGameInit) => memory.add(g),
    /** Every event of one name the recording emitter saw. */
    sent: (event: string) => emitter.sent.filter((s) => s.event === event),
  };
}

export type Harness = Awaited<ReturnType<typeof harness>>;
