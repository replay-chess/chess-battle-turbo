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
import { P3_JOB_KINDS, PAYLOAD_V_MAX, type JobKind } from "@repo/contracts/internal/jobs";
import type { WorkerReadyResponse } from "@repo/contracts/internal/kick";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { EvalCache } from "./cache/evalcache";
import { ensureSeed } from "./cache/seed";
import type { WorkerEnv } from "./config/env";
import { createDb, type Db } from "./db/client";
import { engineFactory, EnginePool, type Engine } from "./engine";
import { createHttpServer } from "./http/server";
import { defaultHandlers, type HandlerMap } from "./jobs";
import { BatchAccumulator } from "./pipeline/batch-events";
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
}

export interface RunningWorker {
  readonly me: string;
  readonly bootId: string;
  readonly server: Server;
  readonly port: number;
  readonly scheduler: Scheduler;
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
  const events = o.events ?? createProductEvents(env.posthog, env.appEnv, log.child({ component: "posthog" }));
  const store = new SqlAnalysisStore(db);
  const batch = new BatchAccumulator({
    emitter,
    clock,
    log: log.child({ component: "batch" }),
    queuedFor: (refs) => store.queuedFor(refs),
  });
  const book = new OpeningBook(() => store.openings(), log.child({ component: "openings" }));
  const handlers = o.handlers ?? defaultHandlers({ store, book, batch, events });
  const kinds: JobKind[] = P3_JOB_KINDS.filter((k) => handlers[k] !== undefined);
  const evalCacheMaxBytes = env.evalCache.maxGb * 1024 ** 3;

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
    bootPlan: () => collectPlan(RECURRING_SLICES, planWindow(clock.now()), log).statements,
    runJob: (job, stopSignal) =>
      runJob(job, {
        db,
        clock,
        log,
        metrics,
        telemetry,
        emitter,
        me,
        appEnv: env.appEnv,
        handlers,
        engine,
        evalCache,
        evalCacheMaxBytes,
        lag,
        stopSignal,
        isWatched: (ref) => scheduler.isWatched(ref),
        takeFault: (ref) => scheduler.takeFault(ref),
      }),
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
    kick: (body) => scheduler.kick(body),
    metrics: () => metrics.snapshot(clock.now(), scheduler.view()),
    ready,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.port, env.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  log.info("worker listening", { host: env.host, port, kinds });

  await scheduler.start();

  let stopping: Promise<void> | null = null;
  const shutdown = () =>
    (stopping ??= (async () => {
      log.info("worker stopping");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await scheduler.stop(STOP_GRACE_MS);
      // The pending `analysis:batch` frames go out before the emitter and the database close (FIX-2).
      await batch.flushAll().catch((error: unknown) => log.warn("analysis:batch flush on stop failed", { error }));
      await events.shutdown(2_000);
      await engine.stop().catch((error: unknown) => log.warn("engine stop failed", { error }));
      evalCache?.close();
      await db.close().catch(() => undefined);
      await telemetry.flush(2_000).catch(() => undefined);
      log.info("worker stopped");
    })());

  return { me, bootId, server, port, scheduler, metrics, engine, evalCache, batch, ready, shutdown };
}
