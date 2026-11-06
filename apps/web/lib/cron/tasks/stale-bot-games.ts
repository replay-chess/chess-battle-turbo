/**
 * Cron task `stale-bot-games` (phase-02 plan §6.6.8, §7.7): bot games nobody touched for 7 days are aborted
 * (status/phase/endMethod/outcome, `meta.abortedBy = "stale"`), their players' game_players rows are closed, and each
 * player's `gamesVersion` is bumped once (archive/home ETags). One statement (`staleBotSweepSql` from @repo/db/live),
 * served by the partial `games_open_idx`. Live human games are swept by the socket server, never here.
 */
import type { Prisma } from "@repo/db";
import { STALE_BOT_DAYS, staleBotSweepSql } from "@repo/db/live";
import type { CronTask } from "./index";

export type QueryRaw = (sql: Prisma.Sql) => Promise<{ aborted: number }[]>;

const defaultQueryRaw: QueryRaw = async (sql) => {
  const { prisma } = await import("@/lib/prisma");
  // (text, ...values), not $queryRaw(Sql): see rawDb() in lib/games/snapshot.server.ts.
  return prisma.$queryRawUnsafe<{ aborted: number }[]>(sql.text, ...sql.values);
};

export function createStaleBotGames(query: QueryRaw = defaultQueryRaw, days: number = STALE_BOT_DAYS): CronTask {
  return {
    name: "stale-bot-games",
    async run() {
      const rows = await query(staleBotSweepSql(days));
      return { count: rows[0]?.aborted ?? 0 };
    },
  };
}

export const staleBotGames = createStaleBotGames();
