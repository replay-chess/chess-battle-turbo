/**
 * Cron task `idempotency-prune` (api-design §2.8 step 4; phase-02 plan §7.7): `idempotency_keys` rows live 24 h.
 * One DELETE on the `createdAt` index.
 */
import type { Prisma } from "@repo/db";
import { pruneIdempotencyKeysSql } from "@/lib/api/idempotency";
import type { CronTask } from "./index";

export type ExecuteSql = (sql: Prisma.Sql) => Promise<number>;

const defaultExecute: ExecuteSql = async (sql) => {
  const { prisma } = await import("@/lib/prisma");
  // (text, ...values), not $executeRaw(Sql): see rawDb() in lib/games/snapshot.server.ts.
  return prisma.$executeRawUnsafe(sql.text, ...sql.values);
};

export function createIdempotencyPrune(exec: ExecuteSql = defaultExecute): CronTask {
  return {
    name: "idempotency-prune",
    async run() {
      return { count: await exec(pruneIdempotencyKeysSql()) };
    },
  };
}

export const idempotencyPrune = createIdempotencyPrune();
