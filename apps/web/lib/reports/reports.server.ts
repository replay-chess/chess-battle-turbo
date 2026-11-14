// W7 `POST /api/reports` (phase-05 plan §7.3 W7, api SYS-6; §11): a member reports a wrong bank position or puzzle.
// One statement answers both the duplicate check and the durable daily limit (reports_reporterId_createdAt_idx): the
// viewer's reports of the last 24 h, read under a per-member transaction lock with the insert (FIX-1). The same target again → 200 `duplicate: true` with the first report's ref; the
// 21st report in 24 h → 429 `rate_limited {reason: "report_limit"}` with `Retry-After` until the oldest is a day old
// (counted from the rows, so a Neon suspend cannot reset it; `report-burst` 5 / 60 s is the route limiter). The target
// must be visible to the viewer: a mistake of theirs, or a puzzle in one of their cards, attempts or sessions; else 404.
// A mistake is named by its referenceId or by the viewer's card key (`m_…`, what the runner holds: `TrainItem` carries
// the card, not the mistake); both resolve to the mistake's referenceId, which is what is stored and deduplicated.
// The note is stored as text (rendered escaped by P12's admin queue). P10 adds the `user` / `game` branches here.
import { Prisma } from "@repo/db";
import { newGameRef } from "@repo/db/games";
import { REPORT_DAILY, type ReportBody, type ReportResult } from "@repo/contracts/http/reports";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { asDate, at, LOCK_REPORT, memberLockSql, num, trainDeps, type TrainDeps } from "@/lib/train/db.server";

const TARGET_DB = { mistake: "MISTAKE", puzzle: "PUZZLE" } as const;

/**
 * The stored `targetRef` of a target, as a scalar SQL expression: a puzzle's Lichess id as sent; a mistake's
 * referenceId, found by that referenceId or by the viewer's card key (`training_cards_userId_itemKey_key`, then
 * `mistakes_pkey`). NULL when the mistake is not the viewer's.
 */
export function targetRefExpr(userId: bigint, body: Pick<ReportBody, "targetType" | "targetRef">): Prisma.Sql {
  if (body.targetType === "puzzle") return Prisma.sql`${body.targetRef}::text`;
  return Prisma.sql`(SELECT m."referenceId" FROM mistakes m
      WHERE m."userId" = ${userId}
        AND (m."referenceId" = ${body.targetRef}
             OR m.id = (SELECT c."mistakeId" FROM training_cards c WHERE c."userId" = ${userId} AND c."itemKey" = ${body.targetRef}))
      LIMIT 1)`;
}

/** The viewer's reports of the last 24 h: count, the oldest, and an earlier report of this target. */
export function recentReportsSql(userId: bigint, now: Date, body: Pick<ReportBody, "targetType" | "targetRef">): Prisma.Sql {
  const target = TARGET_DB[body.targetType];
  return Prisma.sql`SELECT count(*)::int AS n24, min("createdAt") AS oldest,
      (array_agg("referenceId" ORDER BY "createdAt") FILTER (WHERE "targetType" = ${target}::"ReportTarget" AND "targetRef" = ${targetRefExpr(userId, body)}))[1] AS "dupRef"
    FROM reports WHERE "reporterId" = ${userId} AND "createdAt" > ${at(now)} - make_interval(secs => ${REPORT_DAILY.windowSec}::int)`;
}

/** Whether the viewer may report the target, and its stored `targetRef` (null when not visible). */
export function reportTargetSql(userId: bigint, body: Pick<ReportBody, "targetType" | "targetRef">): Prisma.Sql {
  if (body.targetType === "mistake") return Prisma.sql`SELECT ${targetRefExpr(userId, body)} AS ref`;
  const key = `p_${body.targetRef}`;
  return Prisma.sql`SELECT CASE WHEN (
      EXISTS (SELECT 1 FROM training_cards WHERE "userId" = ${userId} AND "itemKey" = ${key})
      OR EXISTS (SELECT 1 FROM training_attempts WHERE "userId" = ${userId} AND "puzzleId" = ${body.targetRef})
      OR EXISTS (SELECT 1 FROM training_sessions WHERE "userId" = ${userId}
                  AND items @> jsonb_build_object('items', jsonb_build_array(jsonb_build_object('key', ${key}::text))))
    ) THEN ${body.targetRef}::text END AS ref`;
}

export async function createReport(viewer: Viewer, body: ReportBody, now: Date, deps: TrainDeps = trainDeps()): Promise<{ status: 200 | 201; body: ReportResult }> {
  const target = TARGET_DB[body.targetType];
  const visible = await deps.db.$queryRaw<{ ref: string | null }[]>(reportTargetSql(viewer.id, body));
  const targetRef = visible[0]?.ref;
  if (!targetRef) throw new DataError("not_found");
  // The duplicate rule and the durable daily limit are "read, then insert": the member's reports run one at a time
  // under a per-member transaction lock, so concurrent POSTs can neither pass 20 a day nor file the same target twice
  // (FIX-1; there is no unique key for "within 24 h").
  return deps.tx(async (db) => {
    await db.$queryRaw(memberLockSql(LOCK_REPORT, viewer.id));
    const r = (await db.$queryRaw<{ n24: number; oldest: unknown; dupRef: string | null }[]>(recentReportsSql(viewer.id, now, body)))[0];
    if (r?.dupRef) return { status: 200 as const, body: { ref: r.dupRef, duplicate: true } };
    if (num(r?.n24) >= REPORT_DAILY.limit) {
      const oldest = asDate(r?.oldest) ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest.getTime() + REPORT_DAILY.windowSec * 1000 - now.getTime()) / 1000));
      throw new ApiError("rate_limited", { retryAfterSec, details: { reason: "report_limit" } });
    }
    const ref = newGameRef(now.getTime());
    await db.$executeRaw(Prisma.sql`INSERT INTO reports ("referenceId", "reporterId", "targetType", "targetRef", fen, reason, note, status, "createdAt")
      VALUES (${ref}, ${viewer.id}, ${target}::"ReportTarget", ${targetRef}, ${body.fen}, ${body.reason.toUpperCase()}::"ReportReason",
              ${body.note ?? null}, 'OPEN', ${at(now)})`);
    return { status: 201 as const, body: { ref, duplicate: false } };
  });
}
