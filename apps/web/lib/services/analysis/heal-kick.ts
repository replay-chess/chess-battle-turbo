// The lost-kick heal (phase-03 plan §7.3 healKick, §5.2 "Lost-kick heal"; P3-D23, AP-09). A1 and A2 are the only
// GETs allowed to write here (registry `sideEffects: ["kick_cas"]`), and only this compare-and-set: a QUEUED job that
// has been due for more than KICK_CAS_WINDOW_MS and was not kicked within it gets `lastKickAt = now()` and one kick.
// However many tabs poll, at most one kick per job per window goes out (the UPDATE's WHERE is the lock). It runs in
// `after()`, so the read's response never waits for it.
import { analyzeDedupeKey } from "@repo/contracts/internal/jobs";
import { KICK_CAS_WINDOW_MS } from "@repo/contracts/internal/kick";
import { Prisma } from "@repo/db";
import { getRouteDeps } from "@/lib/api/context";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { kickWorker } from "./kick";
import { needsHealKick, type JobState } from "./state";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const WINDOW = Prisma.sql`make_interval(secs => ${KICK_CAS_WINDOW_MS / 1000})`;

export function healKickSql(gameId: bigint): Prisma.Sql {
  return Prisma.sql`UPDATE jobs SET "lastKickAt" = ${NOW}
 WHERE "dedupeKey" = ${analyzeDedupeKey(gameId)} AND status = 'QUEUED'
   AND "runAt" < ${NOW} - ${WINDOW}
   AND ("lastKickAt" IS NULL OR "lastKickAt" < ${NOW} - ${WINDOW})
RETURNING id`;
}

/** The CAS; kicks the worker (watching `ref`) only when this call won it. Returns whether it kicked. */
export async function healKick(db: GamesDb, gameId: bigint, ref: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ id: bigint }[]>(healKickSql(gameId));
  if (rows.length === 0) return false;
  getRouteDeps().telemetry.breadcrumb({ category: "analysis", message: "analysis.rekick", level: "info", data: { ref } });
  await kickWorker({ v: 1, reason: "stale_queue", watch: ref });
  return true;
}

const scheduled = new WeakSet<object>();

/**
 * Schedules the heal in `after()` when the row read by this request shows a stale QUEUED job. Once per request
 * (the A1 probe and the A1 payload read may both see it).
 */
export function scheduleHealKick(
  ctx: { req: object; now: Date; after: (task: () => unknown) => void },
  db: GamesDb,
  row: JobState & { gameId: bigint; ref: string },
): boolean {
  if (!needsHealKick(row, ctx.now.getTime()) || scheduled.has(ctx.req)) return false;
  scheduled.add(ctx.req);
  ctx.after(() => healKick(db, row.gameId, row.ref).catch(() => false));
  return true;
}
