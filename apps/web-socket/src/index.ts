// Entry point of the socket server (phase-02 plan 7.4, 7.6, 7.9). Sentry first, then the environment (a bad value
// stops the process with a message naming the variable, never its value; TIMING_PROFILE outside APP_ENV=test exits
// here), then the adapters (src/boot.ts), `listen`, and the boot restore (journal + DB) behind the registry gate.
// SIGTERM/SIGINT and `POST /internal/drain` run the drain (≤ 20 s inside compose's stop_grace_period 30 s) and exit.
import "./instrument";
import { createPrismaClient } from "@repo/db";
import { bootServer } from "./boot";
import { EnvError, loadEnv } from "./config/env";
import { timingFor } from "./config/timing";
import { createLogger } from "./obs/logger";
import { AggregatingMetrics } from "./obs/metrics";
import { createPostHogTelemetry } from "./obs/posthog";
import { flushSentry, reportError, reportWarning, sentryMetricsSink } from "./obs/sentry";
import { DRAIN_BUDGET_MS } from "./persist/drain";

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(`socket server refused to start: ${error instanceof EnvError ? error.message : String(error)}`);
    process.exit(1);
  }
  const log = createLogger({ level: env.logLevel, base: { svc: "ws", env: env.appEnv }, onError: reportError });
  if (!env.databaseUrl) {
    log.error("DATABASE_URL is required (replay_realtime, pooled)");
    process.exit(1);
  }

  const timing = timingFor(env);
  const db = createPrismaClient({ datasourceUrl: env.databaseUrl });
  const metrics = new AggregatingMetrics();
  const telemetry = createPostHogTelemetry(env.posthog, log);

  let exiting = false;
  const exitAfterDrain = (reason: string) => {
    if (exiting) return;
    exiting = true;
    log.info("draining", { reason });
    const hardExit = setTimeout(() => {
      log.error("drain took too long; exiting");
      process.exit(1);
    }, DRAIN_BUDGET_MS + 7_000);
    hardExit.unref();
    server
      .stop()
      .then(() => db.$disconnect().catch(() => undefined))
      .then(() => flushSentry(2_000))
      .then(
        () => process.exit(0),
        (error: unknown) => {
          log.error("shutdown failed", {}, error);
          process.exit(1);
        },
      );
  };

  const server = await bootServer({
    env,
    db,
    log,
    metrics,
    telemetry,
    timing,
    drainTimeoutMs: DRAIN_BUDGET_MS,
    onDrainRequested: () => exitAfterDrain("internal_drain"),
    warn: reportWarning,
    metricsPush: { metrics, sink: sentryMetricsSink() },
  });
  process.on("SIGTERM", () => exitAfterDrain("SIGTERM"));
  process.on("SIGINT", () => exitAfterDrain("SIGINT"));

  const port = await server.handle.listen(env.port);
  log.info("socket server listening", {
    port,
    protocolV1: env.protocolV1,
    timing: timing.profile,
    bootId: server.handle.bootId,
    journal: server.journal ? "on" : "off",
  });
  await server.restore().catch((error: unknown) => {
    // A failed restore must not keep the server unready forever: games then load lazily from their rows.
    log.error("boot restore failed", { op: "restore" }, error);
    server.handle.markRestored();
  });
}

void main();
