/**
 * Cron task `import-prune` (phase-04 plan §6.8, §7.11; data-model housekeeping P22/P23). Two statements:
 *
 *   P23  `WAITING_FOR_MEMBERSHIP` runs older than 30 days are CANCELLED (the member never started a trial), and their
 *        accounts go back to `importState = 'IDLE'` (only accounts still showing that wait), in one statement.
 *   P22  finished runs are deleted: DONE / CANCELLED 30 days after `finishedAt`, FAILED after 90 days.
 *
 * P23 runs first, so a run it cancels today (finishedAt = now) is kept for the next 30 days. Both are idempotent.
 * Stale pending checkouts are WP-D's `stale-checkout` task.
 */
import { Prisma } from "@repo/db";
import type { CronTask } from "./index";

export const WAITING_RUN_MAX_DAYS = 30;
export const FINISHED_RUN_KEEP_DAYS = 30;
export const FAILED_RUN_KEEP_DAYS = 90;

export type QuerySql = (sql: Prisma.Sql) => Promise<{ n: number }[]>;

const utc = (at: Date) => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const days = (n: number) => Prisma.sql`make_interval(days => ${n}::int)`;

/** P23: cancel waiting runs older than 30 days; their accounts' wait state goes back to IDLE. */
export function cancelStaleWaitingRunsSql(now: Date): Prisma.Sql {
  return Prisma.sql`WITH c AS (
  UPDATE import_runs SET status = 'CANCELLED', "finishedAt" = ${utc(now)}, "updatedAt" = ${utc(now)}
   WHERE status = 'WAITING_FOR_MEMBERSHIP' AND "createdAt" < ${utc(now)} - ${days(WAITING_RUN_MAX_DAYS)}
  RETURNING "linkedAccountId"
), a AS (
  UPDATE linked_accounts SET "importState" = 'IDLE', "updatedAt" = ${utc(now)}
   WHERE id IN (SELECT "linkedAccountId" FROM c) AND "importState" = 'WAITING_FOR_MEMBERSHIP'
  RETURNING id
)
SELECT (SELECT count(*) FROM c)::int AS n`;
}

/** P22: delete finished runs past their retention. */
export function pruneFinishedRunsSql(now: Date): Prisma.Sql {
  return Prisma.sql`WITH d AS (
  DELETE FROM import_runs
   WHERE (status IN ('DONE', 'CANCELLED') AND "finishedAt" < ${utc(now)} - ${days(FINISHED_RUN_KEEP_DAYS)})
      OR (status = 'FAILED' AND "finishedAt" < ${utc(now)} - ${days(FAILED_RUN_KEEP_DAYS)})
  RETURNING 1
)
SELECT count(*)::int AS n FROM d`;
}

const defaultQuery: QuerySql = async (sql) => {
  const { prisma } = await import("@/lib/prisma");
  // (text, ...values), not $queryRaw(Sql): see rawDb() in lib/games/snapshot.server.ts.
  return prisma.$queryRawUnsafe<{ n: number }[]>(sql.text, ...sql.values);
};

export function createImportPrune(query: QuerySql = defaultQuery): CronTask {
  return {
    name: "import-prune",
    async run(ctx) {
      const cancelled = Number((await query(cancelStaleWaitingRunsSql(ctx.now)))[0]?.n ?? 0);
      const deleted = Number((await query(pruneFinishedRunsSql(ctx.now)))[0]?.n ?? 0);
      return { count: cancelled + deleted, detail: { cancelled, deleted } };
    },
  };
}

export const importPrune = createImportPrune();
