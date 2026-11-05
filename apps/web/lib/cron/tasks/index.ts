/**
 * The daily cron's ordered task list (Phase 1 plan §7.8), run by `GET /api/cron/daily`.
 *
 * One file per task (`lib/cron/tasks/<name>.ts`), each `{ name, run(ctx) → { count } }`.
 * Tasks run one after another in the order below; a task that throws is logged and
 * reported as `ok: false`, and the next task still runs. Later phases append tasks
 * here (this directory is add-only for other phases, see OWNERS.yml).
 *
 * Nothing here touches the database at import time, so the runner and the task
 * logic are unit-tested with fakes (`tasks.test.ts`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { membershipReconcile } from "./membership-reconcile";
import { rateLimitSweep } from "./rate-limit-sweep";
import { webhookRetention } from "./webhook-retention";

export type CronContext = {
  /** Start time of the run. */
  now: Date;
  /** Current epoch ms (injected so tests can use a fake clock). */
  clock: () => number;
  /** Waits `ms` (injected so tests can use a fake clock). */
  sleep: (ms: number) => Promise<void>;
  /** Runs work after the response (Next `after()`); tests collect the callbacks. */
  after: (fn: () => unknown) => void;
  /** Epoch ms after which long tasks stop picking up new work. */
  deadlineMs: number;
};

export type CronTaskResult = {
  count: number;
  /** Optional per-task breakdown, e.g. `{ buckets: 3, windows: 1 }`. */
  detail?: Record<string, number>;
};

export type CronTask = {
  name: string;
  run(ctx: CronContext): Promise<CronTaskResult>;
};

export type CronTaskReport = {
  ok: boolean;
  ms: number;
  count?: number;
  detail?: Record<string, number>;
};

export type CronRunReport = {
  tasks: Record<string, CronTaskReport>;
  durationMs: number;
};

/** The P1 tasks, in run order. */
export const CRON_TASKS: readonly CronTask[] = [rateLimitSweep, webhookRetention, membershipReconcile];

/** Route budget: `maxDuration = 60`; long tasks stop taking new work after this many ms. */
export const CRON_SOFT_BUDGET_MS = 45_000;

async function logTaskError(name: string, err: unknown): Promise<void> {
  try {
    const { logger } = await import("@/lib/logger");
    logger.error(`[cron] task ${name} failed`, err, { task: name });
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(err, { tags: { cron_task: name } });
  } catch {
    // logging must never stop the run
  }
}

/** Runs the tasks in order. A failing task is reported and logged; the next one still runs. */
export async function runCronTasks(
  tasks: readonly CronTask[],
  ctx: CronContext,
  onError: (name: string, err: unknown) => void | Promise<void> = logTaskError,
): Promise<CronRunReport> {
  const started = ctx.clock();
  const report: Record<string, CronTaskReport> = {};
  for (const task of tasks) {
    const t0 = ctx.clock();
    try {
      const result = await task.run(ctx);
      report[task.name] = {
        ok: true,
        ms: ctx.clock() - t0,
        count: result.count,
        ...(result.detail ? { detail: result.detail } : {}),
      };
    } catch (err) {
      report[task.name] = { ok: false, ms: ctx.clock() - t0 };
      await onError(task.name, err);
    }
  }
  return { tasks: report, durationMs: ctx.clock() - started };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/**
 * `Authorization: Bearer ${CRON_SECRET}`, compared in constant time. A missing or
 * empty secret denies everything (fail closed).
 */
export function cronAuthorized(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  if (!authorization) return false;
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]!), digest(secret));
}
