// Composition of the production socket server (phase-02 plan 7.6, 7.7, 10.2): the journal, the outbox persistence
// over `@repo/db/live`, the socket server with its HTTP surface, the boot restore behind the registry gate, the
// hourly journal cleanup and the 60 s metrics push. src/index.ts adds the environment, Sentry, PostHog, `listen`
// and the signals; the integration tests (test/*.int.test.ts) boot the same composition on a local Postgres.
//
// Database traffic is only: one load per game on the first join, checkpoints/finish of live games, the boot restore
// list and stale sweep, and the opportunistic sweep after a finish. With no live games the server sends no query
// at all (plan 7.7), so the Neon compute can scale to zero.
import type { SqlClient } from "@repo/db/live";
import { createSocketServer, type SocketServerHandle } from "./app";
import type { ServerEnv } from "./config/env";
import { timingFor, type Timing } from "./config/timing";
import type { AggregatingMetrics, LoopLag, MetricsSink } from "./obs/metrics";
import { startMetricsPush } from "./obs/metrics";
import { gamesByPhase } from "./http/metrics";
import { NOOP_SERVER_TELEMETRY, type ServerTelemetry } from "./obs/posthog";
import { Journal } from "./persist/journal";
import { createOutboxPersistence, type OutboxPersistence } from "./persist/outbox";
import { restoreAtBoot, type RestoreReport } from "./persist/restore";
import type { LogFields, Logger, Metrics } from "./ports";

export type BootDb = SqlClient & { $disconnect(): Promise<void> };

export interface BootOptions {
  env: ServerEnv;
  db: BootDb;
  log: Logger;
  metrics: Metrics;
  telemetry?: ServerTelemetry;
  timing?: Timing;
  now?: () => number;
  /** Default `env.journalDir`; null = no journal (restore from the DB rows only). */
  journalDir?: string | null;
  journal?: { fsyncEveryMs?: number; keepAfterEndMs?: number; maxAgeMs?: number };
  loopLag?: LoopLag;
  drainTimeoutMs?: number;
  /** `POST /internal/drain` (index.ts: drain and exit). */
  onDrainRequested?: () => void;
  /** Sentry warning without an exception. */
  warn?: (message: string, fields?: LogFields) => void;
  /** The 60 s push to Sentry (production only). */
  metricsPush?: { metrics: AggregatingMetrics; sink: MetricsSink; everyMs?: number };
  outbox?: { backoffBaseMs?: number; statementBudgetMs?: number; staleSweepEveryMs?: number };
  onEmitParse?: (event: string) => void;
}

export interface BootedServer {
  handle: SocketServerHandle;
  persistence: OutboxPersistence;
  journal: Journal | null;
  /**
   * Runs the boot restore (gate held meanwhile), marks the server restored (`/ready`), then the boot stale sweep.
   * Call once, after `listen`.
   */
  restore(): Promise<RestoreReport>;
  /** Drain (SIGTERM path), then flush telemetry and metrics and close the journal. Idempotent. */
  stop(): Promise<void>;
}

export async function bootServer(options: BootOptions): Promise<BootedServer> {
  const { env, db, log, metrics } = options;
  const now = options.now ?? Date.now;
  const timing = options.timing ?? timingFor(env);
  const telemetry = options.telemetry ?? NOOP_SERVER_TELEMETRY;
  const journalDir = options.journalDir === undefined ? env.journalDir : options.journalDir;

  const journal = journalDir
    ? new Journal({ dir: journalDir, now, log, metrics, ...(options.journal ?? {}) })
    : null;
  await journal?.init();

  let handle: SocketServerHandle | null = null;
  const liveRefs = () => (handle ? [...handle.registry.all()].map((s) => s.ref) : []);
  const persistence = createOutboxPersistence({
    db,
    journal,
    timing,
    now,
    log,
    metrics,
    liveRefs,
    ...(env.webAppUrl ? { siteOrigin: env.webAppUrl } : {}),
    ...(options.outbox ?? {}),
  });

  handle = createSocketServer({
    env,
    persistence,
    log,
    metrics,
    telemetry,
    timing,
    now,
    restored: false,
    ...(options.loopLag ? { loopLag: options.loopLag } : {}),
    ...(options.drainTimeoutMs !== undefined ? { drainTimeoutMs: options.drainTimeoutMs } : {}),
    ...(options.onDrainRequested ? { onDrainRequested: options.onDrainRequested } : {}),
    ...(options.onEmitParse ? { onEmitParse: options.onEmitParse } : {}),
  });
  const h = handle;
  journal?.startCleanup(() => new Set([...liveRefs(), ...(handle ? handle.registry.deferredRefs() : [])]));

  const push = options.metricsPush
    ? startMetricsPush({
        metrics: options.metricsPush.metrics,
        sink: options.metricsPush.sink,
        loopLag: h.loopLag,
        ...(options.metricsPush.everyMs ? { everyMs: options.metricsPush.everyMs } : {}),
        base: { env: env.appEnv },
        gauges: () => {
          const o = h.outboxStats();
          return {
            sockets: h.io.engine?.clientsCount ?? 0,
            gamesByPhase: gamesByPhase(h.registry),
            outboxDepth: o.depth,
            outboxOldestMs: o.oldestMs,
          };
        },
      })
    : null;

  let restoring: Promise<RestoreReport> | null = null;
  const restore = (): Promise<RestoreReport> => {
    if (restoring) return restoring;
    const restored = restoreAtBoot({
      db,
      journal,
      registry: h.registry,
      persistence,
      timing,
      now,
      log,
      metrics,
      ...(options.warn ? { warn: options.warn } : {}),
    });
    // Joins wait for the restore only, never for the sweep after it.
    h.registry.setGate(restored);
    restoring = restored.then(async (report) => {
      h.markRestored();
      await persistence.staleSweep(true);
      return report;
    });
    return restoring;
  };

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      await h.shutdown();
      persistence.stop();
      await journal?.close();
      await telemetry.shutdown(3_000);
      push?.pushNow();
      push?.stop();
    })();
    return stopping;
  };

  return { handle: h, persistence, journal, restore, stop };
}
