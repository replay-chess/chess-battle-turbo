/**
 * Cron task `stale-checkout` (phase-04 plan 7.11): clears `pendingCheckout*` older than 24 h for users who are still
 * not entitled (lib/billing/housekeeping.ts). One UPDATE; idempotent.
 */
import type { Prisma } from "@repo/db";
import { clearStaleCheckoutsSql } from "@/lib/billing/housekeeping";
import type { CronTask } from "./index";

export type ExecuteSql = (sql: Prisma.Sql) => Promise<number>;

const defaultExecute: ExecuteSql = async (sql) => {
  const { prisma } = await import("@/lib/prisma");
  // (text, ...values), not $executeRaw(Sql): see rawDb() in lib/games/snapshot.server.ts.
  return prisma.$executeRawUnsafe(sql.text, ...sql.values);
};

export function createStaleCheckout(exec: ExecuteSql = defaultExecute): CronTask {
  return {
    name: "stale-checkout",
    async run(ctx) {
      return { count: await exec(clearStaleCheckoutsSql(ctx.now)) };
    },
  };
}

export const staleCheckout = createStaleCheckout();
