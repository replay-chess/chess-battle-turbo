/**
 * Cron task `worker-alive` (phase-03 plan §3.2 "P1's daily Vercel cron", §7.5, AP-08): the "is the analysis worker
 * alive" backstop. The worker never polls the database on a timer; it wakes on kicks and on its own `nextRunAt`. If
 * it is down, nothing else notices until a member opens a review, so once a day:
 *
 *   1. a signed `GET /internal/metrics` (kid `webwk`, served from the worker's memory: no database query);
 *   2. one signed kick `{v:1, reason:"cron_backstop"}`, which drains anything a lost kick left QUEUED.
 *
 * Alerts go to Sentry (fingerprinted, so a long outage is one issue): `analysis.worker_down` (error) when the metrics
 * call fails, answers non-2xx or an unreadable body, or ANALYSIS_WORKER_URL is unset; `analysis.housekeeping_missed`
 * (warning) when the worker is up but no HOUSEKEEPING finished in the last 26 h (the daily planner stalled). The task
 * never throws for these, so the cron report keeps the details; a failed kick is reported by kickWorker itself.
 */
import { WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import { InternalFetchConfigError } from "@/lib/internal/fetch";
import { kickWorker, workerOrigin, workerSignature, type KickResult } from "@/lib/services/analysis/kick";
import type { CronTask, CronTaskResult } from "./index";

type Env = Readonly<Record<string, string | undefined>>;

export const WORKER_METRICS_PATH = "/internal/metrics";
export const WORKER_ALIVE_TIMEOUT_MS = 5_000;
/** HOUSEKEEPING runs once a day at 21:00 UTC; more than this without one is an alert. */
export const HOUSEKEEPING_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export type AlertLevel = "error" | "warning";

export type WorkerAliveDeps = {
  env: () => Env;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  kick: () => Promise<KickResult>;
  alert: (message: string, level: AlertLevel, extra: Record<string, unknown>) => void | Promise<void>;
};

const defaultDeps: WorkerAliveDeps = {
  env: () => process.env,
  fetch: (url, init) => fetch(url, init),
  kick: () => kickWorker({ v: 1, reason: "cron_backstop" }),
  alert: async (message, level, extra) => {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(message, { level, tags: { cron_task: "worker-alive" }, fingerprint: [message], extra });
  },
};

type Probe =
  | { ok: true; metrics: WorkerMetricsResponse }
  | { ok: false; reason: "not_configured" | "http_error" | "network" | "bad_body"; status?: number };

async function probeMetrics(deps: WorkerAliveDeps, nowMs: number): Promise<Probe> {
  const env = deps.env();
  const origin = workerOrigin(env);
  if (!origin) return { ok: false, reason: "not_configured" };
  let headers: Record<string, string>;
  try {
    headers = { ...workerSignature(env, "GET", WORKER_METRICS_PATH, "", nowMs) };
  } catch (err) {
    if (err instanceof InternalFetchConfigError) return { ok: false, reason: "not_configured" };
    throw err;
  }
  let res: Response;
  try {
    res = await deps.fetch(`${origin}${WORKER_METRICS_PATH}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(WORKER_ALIVE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    return { ok: false, reason: "http_error", status: res.status };
  }
  const parsed = WorkerMetricsResponse.safeParse(await res.json().catch(() => null));
  return parsed.success ? { ok: true, metrics: parsed.data } : { ok: false, reason: "bad_body", status: res.status };
}

const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);
const max = (values: Record<string, number>) => Object.values(values).reduce((a, b) => Math.max(a, b), 0);

export function createWorkerAlive(overrides: Partial<WorkerAliveDeps> = {}): CronTask {
  const deps: WorkerAliveDeps = { ...defaultDeps, ...overrides };
  return {
    name: "worker-alive",
    async run(ctx): Promise<CronTaskResult> {
      const nowMs = ctx.clock();
      const probe = await probeMetrics(deps, nowMs);
      if (!probe.ok) {
        await deps.alert("analysis.worker_down", "error", { reason: probe.reason, status: probe.status ?? null });
        return { count: 0, detail: { alive: 0, kicked: 0 } };
      }
      const { metrics } = probe;
      const lastHousekeeping = metrics.lastHousekeepingAt ? Date.parse(metrics.lastHousekeepingAt) : null;
      const bootedMs = nowMs - metrics.uptimeSec * 1000;
      // A worker that booted less than 26 h ago may not have reached its first 21:00 UTC run yet.
      const stale =
        lastHousekeeping === null ? nowMs - bootedMs > HOUSEKEEPING_MAX_AGE_MS : nowMs - lastHousekeeping > HOUSEKEEPING_MAX_AGE_MS;
      if (stale) {
        await deps.alert("analysis.housekeeping_missed", "warning", {
          lastHousekeepingAt: metrics.lastHousekeepingAt,
          uptimeSec: metrics.uptimeSec,
          workerId: metrics.workerId,
        });
      }
      const kick = await deps.kick();
      return {
        count: 1,
        detail: {
          alive: 1,
          kicked: kick.ok ? 1 : 0,
          housekeepingStale: stale ? 1 : 0,
          queueDepth: sum(metrics.queue.depth),
          queueOldestSec: max(metrics.queue.oldestSec),
        },
      };
    },
  };
}

export const workerAlive = createWorkerAlive();
