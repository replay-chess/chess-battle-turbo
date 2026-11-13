// Import-status DAL (phase-04 plan §7.4 ACC-7, §5.7, §9.2; D4-31). Server-only.
//
//   getImportStatus(viewer)   the viewer's newest five runs and the first imported review, ONE statement
//                             (import_runs_userId_createdAt_idx, Limit 5 → games_pkey, game_players_pkey). Also
//                             returns the accounts whose run has sat QUEUED for more than 30 s: the route heals them
//                             through the kick CAS in `after()` (the only write ACC-7 may make, `kick_cas`).
import { IMPORT_STALE_QUEUED_MS, IMPORT_STATUS_RUNS_MAX, type ImportStatusData } from "@repo/contracts/http/import";
import type { AnalysisStatusWire } from "@repo/contracts/http/review";
import { Prisma } from "@repo/db";
import type { Viewer } from "@/lib/auth/viewer";
import { rawDb, type GamesDb } from "@/lib/games/snapshot.server";
import { toRunView, type RunRow } from "./import-rows";

type StatusRow = RunRow & {
  linkedAccountId: bigint;
  firstGameRef: string | null;
  firstAnalysis: string | null;
  momentsCount: number | null;
};

export function importStatusSql(userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT r."referenceId", r.provider::text AS provider, r.trigger::text AS trigger, r.status::text AS status,
       r.phase, r.seen, r.total, r.imported, r.skipped, r.error, r."analysisQueued", r.analysed, r."linkedAccountId",
       r."startedAt", r."finishedAt", r."updatedAt",
       fg."referenceId" AS "firstGameRef", fg."analysisStatus"::text AS "firstAnalysis", fp."momentsCount"
  FROM import_runs r
  LEFT JOIN games fg ON fg.id = r."firstGameId"
  LEFT JOIN game_players fp ON fp."gameId" = r."firstGameId" AND fp."userId" = r."userId"
 WHERE r."userId" = ${userId}::bigint
 ORDER BY r."createdAt" DESC
 LIMIT ${IMPORT_STATUS_RUNS_MAX}`;
}

export type ImportStatus = {
  data: ImportStatusData;
  /** Accounts whose run is QUEUED for longer than IMPORT_STALE_QUEUED_MS (the route's kick CAS candidates). */
  staleQueued: bigint[];
  /** A run is parked WAITING_FOR_MEMBERSHIP (a member's status read releases it: the fan-out's backstop, FIX-1). */
  waiting: boolean;
};

const ANALYSIS: ReadonlySet<string> = new Set(["none", "queued", "running", "done", "failed", "skipped"]);

/**
 * The runs as sent: newest first, and the `error` only on each provider's newest run (FIX-2, plan §9.6
 * "ImportStatusData ≤ 2 KB (5 runs)"). The client reads only the active run or the newest one (lib/api/queries/imports.ts
 * activeOrNewestRun, lib/onboarding/import-card.ts), so an older run's error was never shown, and five failed runs
 * carrying theirs reached ~2.2 KB.
 */
export function statusRunViews(rows: readonly RunRow[]): ImportStatusData["runs"] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const view = toRunView(row);
    const newestOfProvider = !seen.has(view.provider);
    seen.add(view.provider);
    return newestOfProvider ? view : { ...view, error: null };
  });
}

export function toImportStatus(rows: StatusRow[], now: Date): ImportStatus {
  const runs = statusRunViews(rows);
  const first = rows.find((r) => r.firstGameRef);
  const analysis = first?.firstAnalysis?.toLowerCase();
  const staleQueued = rows
    .filter((r) => r.status === "QUEUED" && now.getTime() - new Date(r.updatedAt).getTime() > IMPORT_STALE_QUEUED_MS)
    .map((r) => BigInt(r.linkedAccountId));
  return {
    data: {
      runs,
      firstReview:
        first && first.firstGameRef && analysis && ANALYSIS.has(analysis)
          ? {
              gameRef: first.firstGameRef,
              analysisStatus: analysis as AnalysisStatusWire,
              momentsCount: first.momentsCount === null || first.momentsCount === undefined ? null : Number(first.momentsCount),
            }
          : null,
    },
    staleQueued: [...new Set(staleQueued)],
    waiting: rows.some((r) => r.status === "WAITING_FOR_MEMBERSHIP"),
  };
}

/** `now` is the request clock (ctx.now in a route, requestNow() in a server component). */
export async function getImportStatus(viewer: Pick<Viewer, "id">, opts: { db?: GamesDb; now: Date }): Promise<ImportStatus> {
  const db = opts.db ?? rawDb((await import("@/lib/prisma")).prisma);
  const rows = await db.$queryRaw<StatusRow[]>(importStatusSql(viewer.id));
  return toImportStatus(rows, opts.now);
}
