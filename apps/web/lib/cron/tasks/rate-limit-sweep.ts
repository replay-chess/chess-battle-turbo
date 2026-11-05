/**
 * Cron task `rate-limit-sweep`: deletes limiter rows whose window ended more than an
 * hour ago, from both stores (plan §6.3). Seq scans on tiny tables.
 */
import type { CronTask } from "./index";

export const RATE_LIMIT_SWEEP_SQL = {
  buckets: `DELETE FROM "rate_limit_buckets" WHERE "resetAt" < (now() AT TIME ZONE 'UTC') - interval '1 hour'`,
  windows: `DELETE FROM "rate_limit_windows" WHERE "resetAt" < (now() AT TIME ZONE 'UTC') - interval '1 hour'`,
} as const;

export type ExecuteRaw = (sql: string) => Promise<number>;

export const defaultExecuteRaw: ExecuteRaw = async (sql) => {
  const { prisma } = await import("@/lib/prisma");
  return prisma.$executeRawUnsafe(sql);
};

export function createRateLimitSweep(exec: ExecuteRaw = defaultExecuteRaw): CronTask {
  return {
    name: "rate-limit-sweep",
    async run() {
      const buckets = await exec(RATE_LIMIT_SWEEP_SQL.buckets);
      const windows = await exec(RATE_LIMIT_SWEEP_SQL.windows);
      return { count: buckets + windows, detail: { buckets, windows } };
    },
  };
}

export const rateLimitSweep = createRateLimitSweep();
