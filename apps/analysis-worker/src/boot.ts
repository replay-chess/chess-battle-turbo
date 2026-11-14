// Worker boot and shutdown (phase-03 plan §8.12):
//
//   env guards (config/env.ts) → open the eval cache (+ first-boot seed) → spawn the engine (uci, isready)
//   → HTTP server on :3003 → boot batch (reap + DAILY_PLAN) → drain → sleep / kick …
//
// SIGTERM (compose `stop_grace_period: 30s`): the server stops accepting, the scheduler stops claiming, the running
// job stops at its next safe point and is released without counting the attempt, then the engine quits, the cache
// flushes and the process exits 0.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { P3_JOB_KINDS, P4_JOB_KINDS, P5_JOB_KINDS, PAYLOAD_V_MAX, type JobKind } from "@repo/contracts/internal/jobs";
import type { WorkerReadyResponse } from "@repo/contracts/internal/kick";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { EvalCache } from "./cache/evalcache";
import { ensureSeed } from "./cache/seed";
import type { WorkerEnv } from "./config/env";
import { createDb, type Db } from "./db/client";
import { engineFactory, EnginePool, type Engine } from "./engine";
import { createHttpServer } from "./http/server";
import { defaultHandlers, type HandlerMap } from "./jobs";
import { failReapedImports } from "./jobs/import-sync";
import { FaultTable, faultingFetch } from "./dev/faults";
import { devFaultRoute } from "./http/routes/dev-fault";
import { ProviderLookup } from "./http/routes/provider-lookup";
import { createProviders, type FetchLike, type ImportProviders } from "./providers";
import { measuredFetch } from "./providers/measure";
import { importMetric } from "./import/metrics";
import { IoLane, routeKick } from "./queue/lanes";
import { BatchAccumulator } from "./pipeline/batch-events";
import { MistakesAddedCoalescer } from "./extract/coalesce";
import { OpeningBook } from "./pipeline/openings";
import { SqlAnalysisStore } from "./pipeline/sql-store";
import { createProductEvents, type ProductEvents } from "./obs/posthog";
import { runJob } from "./jobs/runner";
import { WORKER_VERSION } from "./version";
import { createLogger, type Logger } from "./obs/log";
import { Metrics } from "./obs/metrics";
import { noopTelemetry, sentryTelemetry, type Telemetry } from "./obs/telemetry";
import { realClock, type Clock } from "./scheduler/clock";
import { collectPlan, planWindow } from "./scheduler/daily-plan";
import { RECURRING_SLICES } from "./scheduler/recurring";
import { importBackstopStatement, releaseParkedImportsStatement } from "./scheduler/recurring/import-backstop";
import { Scheduler } from "./scheduler/scheduler";
import { Emitter, type EmitSink } from "./socket/emit";
import { LagPause, LoadProbe } from "./socket/load";

/** The scheduler waits this long for the running job to release itself on SIGTERM (compose grace is 30 s). */
export const STOP_GRACE_MS = 25_000;

export type CacheState = WorkerReadyResponse["evalCache"];

export interface WorkerOverrides {
  clock?: Clock;
  db?: Db;
  log?: Logger;
  telemetry?: Telemetry;
  emitter?: EmitSink;
  engineFactory?: () => Engine;
  handlers?: HandlerMap;
  events?: ProductEvents;
  fetchImpl?: typeof fetch;
  bootId?: string;
  /** P4: the transport of the provider clients (tests: the in-process upstream mock; dev: the fault table). */
  providerFetch?: FetchLike;
}

export interface RunningWorker {
  readonly me: string;
  readonly bootId: string;
  readonly server: Server;
  readonly port: number;
  readonly scheduler: Scheduler;
  /** P4: the I/O lane (imports), next to the engine lane (`scheduler`). */
  readonly lane: IoLane;
  readonly providers: ImportProviders;
  /** P4: the Chess.com lookup fallback (`/internal/provider/chesscom/lookup`), on the providers' gates. */
  readonly lookup: ProviderLookup;
  /** P4: the provider fault table; null unless IMPORT_FAULTS_ALLOWED (never in production). */
  readonly faults: FaultTable | null;
  readonly metrics: Metrics;
  readonly engine: EnginePool;
  readonly evalCache: EvalCache | null;
  readonly batch: BatchAccumulator;
  ready(): WorkerReadyResponse;
  shutdown(): Promise<void>;
}

export async function bootWorker(env: WorkerEnv, o: WorkerOverrides = {}): Promise<RunningWorker> {
  const clock = o.clock ?? realClock();
  const bootId = o.bootId ?? randomBytes(4).toString("hex");
  const me = `${env.workerId}-${bootId}`;
  const log = o.log ?? createLogger(env.logLevel, { svc: "analysis-worker", worker: me });
  const metrics = new Metrics(
    { workerId: me, bootId, version: WORKER_VERSION, profile: ENGINE_PROFILE.id },
    clock.now(),
  );
  const telemetry =
    o.telemetry ??
    (env.sentryDsn
      ? await sentryTelemetry({
          dsn: env.sentryDsn,
          environment: env.appEnv,
          release: `analysis-worker@${WORKER_VERSION}`,
        })
      : noopTelemetry);
  log.info("worker booting", {
    appEnv: env.appEnv,
    engine: env.engine.kind,
    evalCache: env.evalCache.enabled,
    db: env.dbDriver,
  });

  // ── eval cache (E2) ───────────────────────────────────────────────────────────────────────────────────────────
  let cacheState: CacheState = env.evalCache.enabled ? "seeding" : "off";
  let evalCache: EvalCache | null = null;
  if (env.evalCache.enabled) {
    try {
      evalCache = EvalCache.open({
        path: env.evalCache.path,
        log: log.child({ component: "evalcache" }),
        metrics,
        nowMs: () => clock.now(),
      });
      if (env.evalCache.seedUrl)
        await ensureSeed({ cache: evalCache, url: env.evalCache.seedUrl, log, fetchImpl: o.fetchImpl });
      cacheState = "open";
    } catch (error) {
      cacheState = "failed";
      evalCache = null;
      log.error("eval cache unavailable", { error });
      telemetry.captureException(error, { component: "evalcache" });
    }
  }

  // ── engine ──────────────────────────────────────────────────────────────────────────────────────────────────
  const engine = new EnginePool({
    factory: o.engineFactory ?? engineFactory(env, log),
    log: log.child({ component: "engine" }),
    metrics,
  });
  await engine.start();
  log.info("engine ready", { name: engine.name, build: engine.buildId });

  // ── database, socket hop, handlers ─────────────────────────────────────────────────────────────────────────
  const db =
    o.db ??
    createDb({ url: env.databaseUrl, driver: env.dbDriver }, log.child({ component: "db" }), (c) => {
      metrics.dbStatements = c.statements;
      metrics.dbRetries = c.retries;
    });
  const emitter =
    o.emitter ??
    new Emitter({
      baseUrl: env.wsInternalUrl,
      keys: env.internalKeys,
      log: log.child({ component: "emit" }),
      metrics,
      nowMs: () => clock.now(),
      fetchImpl: o.fetchImpl,
    });
  const lag = env.wsInternalUrl
    ? new LagPause({
        source: new LoadProbe({
          baseUrl: env.wsInternalUrl,
          keys: env.internalKeys,
          clock,
          log,
          fetchImpl: o.fetchImpl,
        }),
        thresholdMs: env.lagPauseMs,
        clock,
        metrics,
      })
    : null;
  const events =
    o.events ??
    createProductEvents(env.posthog, env.appEnv, log.child({ component: "posthog" }), {
      untraced: telemetry.untraced?.bind(telemetry),
    });
  const store = new SqlAnalysisStore(db, { training: env.bank.enabled });
  const batch = new BatchAccumulator({
    emitter,
    clock,
    log: log.child({ component: "batch" }),
    queuedFor: (refs) => store.queuedFor(refs),
  });
  const book = new OpeningBook(() => store.openings(), log.child({ component: "openings" }));
  // The provider transport: the real fetch (tests: the upstream mock), behind the dev fault table when it is allowed,
  // behind the upstream stopwatch (import.upstream_ms). One transport and one gate per provider for the imports and
  // the lookup endpoint alike.
  const bases = { chesscom: env.imports.chesscomBaseUrl, lichess: env.imports.lichessBaseUrl };
  const faults = env.faultsAllowed ? new FaultTable(() => clock.now()) : null;
  if (faults) log.warn("IMPORT_FAULTS_ALLOWED: the provider fault table is on (dev/test only)");
  const baseFetch: FetchLike = o.providerFetch ?? ((input, init) => fetch(input, init));
  const providerFetch = measuredFetch(faults ? faultingFetch(baseFetch, faults, bases) : baseFetch, bases, clock, {
    metrics,
    telemetry,
  });
  const providers = createProviders({ settings: env.imports, clock, fetch: providerFetch });
  const lookup = new ProviderLookup({
    gates: providers.gates,
    settings: env.imports,
    clock,
    fetch: providerFetch,
    log: log.child({ component: "provider-lookup" }),
    sink: { metrics, telemetry },
  });
  // P5: `mistakes:added` frames of the EXTRACT_MISTAKES backfill, coalesced per user (≤ 1 per 60 s).
  const mistakesAdded = new MistakesAddedCoalescer({ emitter, clock, log: log.child({ component: "mistakes-added" }) });
  const handlers =
    o.handlers ??
    defaultHandlers({
      store,
      book,
      batch,
      events,
      imports: { providers, settings: env.imports },
      bank: env.bank,
      mistakesAdded,
    });
  // The engine lane: the analysis kinds and P5's EXTRACT_MISTAKES (its line searches use the engine).
  const kinds: JobKind[] = [...P3_JOB_KINDS, ...P5_JOB_KINDS].filter((k) => handlers[k] !== undefined);
  // The I/O lane claims the import kinds this build handles; IMPORT_PAUSED leaves it without kinds (claims nothing).
  const ioKinds: JobKind[] = env.imports.paused ? [] : P4_JOB_KINDS.filter((k) => handlers[k] !== undefined);
  const evalCacheMaxBytes = env.evalCache.maxGb * 1024 ** 3;

  const runnerDeps = (runAs: string, stopSignal: AbortSignal) => ({
    db,
    clock,
    log,
    metrics,
    telemetry,
    emitter,
    me: runAs,
    appEnv: env.appEnv,
    handlers,
    engine,
    evalCache,
    evalCacheMaxBytes,
    lag,
    stopSignal,
    isWatched: (ref: string) => scheduler.isWatched(ref),
    takeFault: (ref: string) => scheduler.takeFault(ref),
    // D1: an import (I/O lane) queues ANALYZE_GAME jobs for the engine lane, which sleeps without polling.
    wakeEngine: () => scheduler.wake(),
  });
  const lane = new IoLane({
    db,
    clock,
    log: log.child({ component: "io-lane" }),
    metrics,
    emitter,
    me,
    workerId: env.workerId,
    kinds: ioKinds,
    payloadVMax: PAYLOAD_V_MAX,
    events,
    runJob: (job, slotMe, stopSignal) => {
      // import.queue_wait_ms (§10.2): how long a due import waited for a free slot (database clock on both sides).
      importMetric({ metrics, telemetry }, "import.queue_wait_ms", Math.max(0, job.claimedAtMs - Math.max(job.runAtMs, job.createdAtMs)), {
        kind: job.kind,
      });
      return runJob(job, runnerDeps(slotMe, stopSignal));
    },
    onReaped: (jobs) => failReapedImports({ db, emitter, clock, log }, jobs),
  });

  // The runner's closures call back into the scheduler only after it exists (jobs run after start()).
  const scheduler: Scheduler = new Scheduler({
    db,
    clock,
    log: log.child({ component: "scheduler" }),
    metrics,
    emitter,
    appEnv: env.appEnv,
    me,
    workerId: env.workerId,
    kinds,
    payloadVMax: PAYLOAD_V_MAX,
    envFault: env.fault,
    events,
    telemetry,
    onDrainEnd: async () => {
      await batch.flushAtDrainEnd();
      await events.flush();
    },
    // DAILY_PLAN's rows, and (when this build imports and IMPORT_PAUSED is off) the daily-sync backstop: the boot is
    // awake anyway (D4-27). A paused worker enqueues no import work; the next unpaused boot or HOUSEKEEPING sweeps.
    bootPlan: () => [
      ...collectPlan(RECURRING_SLICES, planWindow(clock.now()), log).statements,
      ...(handlers.IMPORT_SYNC && !env.imports.paused
        ? [importBackstopStatement(), releaseParkedImportsStatement(env.imports.paywall)]
        : []),
    ],
    siblingIds: lane.bootIds.filter((id) => id !== me),
    runJob: (job, stopSignal) => runJob(job, runnerDeps(me, stopSignal)),
  });

  const ready = (): WorkerReadyResponse => {
    const engineState = engine.state;
    const ok = (engineState === "ready" || engineState === "fake") && (cacheState === "open" || cacheState === "off");
    return { ready: ok, engine: engineState, evalCache: cacheState, draining: scheduler.view().draining };
  };

  // ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────────
  const server = createHttpServer({
    acceptKeys: env.acceptKeys,
    nowMs: () => clock.now(),
    log: log.child({ component: "http" }),
    kick: (body) => routeKick(body, scheduler, lane),
    metrics: () => metrics.snapshot(clock.now(), scheduler.view()),
    ready,
    lookup: (body) => lookup.lookup(body),
    devFault: faults ? devFaultRoute(faults, log.child({ component: "dev-fault" })) : undefined,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.port, env.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  log.info("worker listening", { host: env.host, port, kinds, ioKinds });

  await scheduler.start();
  lane.start();

  let stopping: Promise<void> | null = null;
  const shutdown = () =>
    (stopping ??= (async () => {
      log.info("worker stopping");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all([scheduler.stop(STOP_GRACE_MS), lane.stop(STOP_GRACE_MS)]);
      // The pending `analysis:batch` frames go out before the emitter and the database close (FIX-2).
      await batch.flushAll().catch((error: unknown) => log.warn("analysis:batch flush on stop failed", { error }));
      await mistakesAdded.flushAll().catch((error: unknown) => log.warn("mistakes:added flush on stop failed", { error }));
      await events.shutdown(2_000);
      await engine.stop().catch((error: unknown) => log.warn("engine stop failed", { error }));
      evalCache?.close();
      await db.close().catch(() => undefined);
      await telemetry.flush(2_000).catch(() => undefined);
      log.info("worker stopped");
    })());

  return {
    me,
    bootId,
    server,
    port,
    scheduler,
    lane,
    providers,
    lookup,
    faults,
    metrics,
    engine,
    evalCache,
    batch,
    ready,
    shutdown,
  };
}
