import { z } from "zod";
import { IsoDateTime } from "./common";

export const AppEnv = z.enum(["dev", "production", "test", "local"]);
export type AppEnv = z.infer<typeof AppEnv>;

/** GET /api/health?deep=1 */
export const HealthQuery = z.object({ deep: z.literal("1").optional() });
export type HealthQuery = z.infer<typeof HealthQuery>;

/** GET /api/health. `db` only with deep=1 (the only path that wakes Neon). */
export const HealthData = z.object({
  ok: z.literal(true),
  buildId: z.string(),
  env: AppEnv,
  time: IsoDateTime,
  db: z.object({ ok: z.boolean(), ms: z.number() }).optional(),
});
export type HealthData = z.infer<typeof HealthData>;

/** GET /api/healthcheck: plain "ok", unchanged for existing monitors (deleted in P11). */
export const HealthcheckText = z.literal("ok");

export const CronTaskResult = z.object({
  ok: z.boolean(),
  ms: z.number(),
  count: z.number().int().optional(),
  /** Per-task tallies, e.g. `{ buckets, windows }` from the rate-limit sweep or the reconcile counts. */
  detail: z.record(z.string(), z.number()).optional(),
});
export type CronTaskResult = z.infer<typeof CronTaskResult>;

/** GET /api/cron/daily: one entry per task in lib/cron/tasks/index.ts order. */
export const CronDailyData = z.object({
  tasks: z.record(z.string(), CronTaskResult),
  durationMs: z.number(),
});
export type CronDailyData = z.infer<typeof CronDailyData>;
