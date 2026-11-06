// Socket boot restore list (phase-02 plan 6.6.8, 7.6): once per boot. Served by the partial games_open_idx
// (a few dozen open rows); the lastMoveAt filter runs on those heap rows only.
import { Prisma } from "#generated";
import type { SqlClient } from "./types";

/** `RESTORE_WINDOW_MS` (plan 8.20). */
export const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;

export function restoreListSql(windowMs: number = RESTORE_WINDOW_MS): Prisma.Sql {
  return Prisma.sql`
    SELECT "referenceId" AS ref FROM games
     WHERE status = 'IN_PROGRESS' AND mode IN ('FRIEND', 'ONLINE', 'TOURNAMENT')
       AND "lastMoveAt" > now() - (${windowMs}::int * interval '1 millisecond')`;
}

/** Refs of live human games that moved within the window (restore candidates, merged with the journal files). */
export async function restoreList(db: SqlClient, windowMs: number = RESTORE_WINDOW_MS): Promise<string[]> {
  const rows = await db.$queryRaw<{ ref: string }[]>(restoreListSql(windowMs));
  return rows.map((r) => r.ref);
}
