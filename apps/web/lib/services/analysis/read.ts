// The review reads behind A1, A2, A8 and the review RSC pages (phase-03 plan §7.3 probeReview / getReview /
// getReviewStatus / getReviewComplete, §9.2). One statement each (A2 adds the lazy `legend_facts` insert only when
// the game has a legend position and no facts row yet). Non-players get `DataError("not_found")`; admins read any
// game (the member row stands in for "you"). The RSC entry points with React cache() live in WEB/lib/data/review.ts.
import { Prisma } from "@repo/db";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { DataError } from "@/lib/data/errors";
import { siteOrigin } from "@/lib/routes";
import type { Viewer } from "@/lib/auth/viewer";
import { insertLegendFactsSql, legendFactsFor, type FactsRowState } from "./legend-facts";
import { isAdmin } from "./reader";
import { bankContextOf, bankFieldsEnabled } from "@/lib/train/reviewBank.server";
import { reviewReadSql, type ProbeRow, type ReviewRow, type StatusRow } from "./review-sql";
import { bankInputOf, buildCompleteView, buildReviewDTO, buildStatusDTO, reviewEtag, statusEtag } from "./review-dto";
import type { ReviewCompleteView, ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";

type ViewerRef = Pick<Viewer, "id" | "role"> & Partial<Pick<Viewer, "onboarding" | "user" | "entitlement" | "ref">>;

/** P5 review bank fields (phase-05 §7.3): `bank` = the `train` flag; undefined → asked for this viewer. */
export type ReadBankOption = { bank?: boolean };

const argsOf = (viewer: ViewerRef, ref: string, bank = false) => ({ viewerId: viewer.id, ref, admin: isAdmin(viewer), bank });

/** The `train` flag for a full viewer (the review bank fields); a partial viewer (tests, scripts) reads P3's fields. */
async function bankOn(viewer: ViewerRef, option: ReadBankOption | undefined): Promise<boolean> {
  if (option?.bank !== undefined) return option.bank;
  if (!viewer.user || !viewer.entitlement || !viewer.ref) return false;
  return bankFieldsEnabled(viewer as Viewer);
}

/** The §6.4 probe: ETag parts + job state. Null for an unknown game or a non-player. */
export async function probeReview(db: GamesDb, viewer: ViewerRef, ref: string, option?: ReadBankOption): Promise<ProbeRow | null> {
  const rows = await db.$queryRaw<ProbeRow[]>(reviewReadSql("probe", argsOf(viewer, ref, await bankOn(viewer, option))));
  return rows[0] ?? null;
}

export async function loadReviewRow(db: GamesDb, viewer: ViewerRef, ref: string, option?: ReadBankOption): Promise<ReviewRow | null> {
  const rows = await db.$queryRaw<ReviewRow[]>(reviewReadSql("review", argsOf(viewer, ref, await bankOn(viewer, option))));
  return rows[0] ?? null;
}

export type ReviewRead = { dto: ReviewDTO; row: ReviewRow; etag: string };

/** A1 / the review page: the payload, its row (job state for the kick CAS) and its strong ETag. */
export async function getReview(db: GamesDb, viewer: ViewerRef, ref: string, nowMs: number, option?: ReadBankOption): Promise<ReviewRead> {
  const bank = await bankOn(viewer, option);
  const row = await loadReviewRow(db, viewer, ref, { bank });
  if (!row) throw new DataError("not_found");
  const dto = buildReviewDTO(row, { nowMs, siteOrigin: siteOrigin(), ...(bank ? { bank: bankContextOf(viewer, nowMs) } : {}) });
  return { dto, row, etag: reviewEtag(row, nowMs) };
}

export type StatusRead = { dto: ReviewStatusDTO; row: StatusRow; etag: string };

/**
 * A2: the status, the review summary and the legend summary. A legend game with no facts row gets one now (the
 * declared GET side effect `legend_facts`; derived data, `ON CONFLICT DO NOTHING`).
 */
export async function getReviewStatus(db: GamesDb, viewer: ViewerRef, ref: string, nowMs: number, option?: ReadBankOption): Promise<StatusRead> {
  const bank = await bankOn(viewer, option);
  const rows = await db.$queryRaw<StatusRow[]>(reviewReadSql("status", argsOf(viewer, ref, bank)));
  const row = rows[0];
  if (!row) throw new DataError("not_found");
  let comparison: { status: FactsRowState["status"]; facts: unknown } | null = row.comparisonStatus
    ? { status: row.comparisonStatus, facts: row.comparisonFacts }
    : null;
  let probe: ProbeRow = row;
  if (!comparison && row.chessPositionId != null && row.moves !== null && row.gameStatus === "COMPLETED") {
    const facts = legendFactsFor({
      ...row,
      startFen: row.startingFen,
      startPly: row.startPly,
      moves: row.moves,
      member: row.color,
      legendPgn: row.legendPgn,
      legendMeta: row.legendMeta,
      legendMoveNumber: row.legendMoveNumber,
    });
    if (facts) {
      const inserted = await db.$queryRaw<FactsRowState[]>(
        insertLegendFactsSql({ gameId: row.gameId, userId: row.memberId, chessPositionId: row.chessPositionId, facts }),
      );
      const state = inserted[0];
      comparison = { status: state?.status ?? "FACTS_READY", facts: state?.facts ?? facts };
      probe = { ...row, comparisonStatus: state?.status ?? "FACTS_READY", comparisonUpdatedAt: state?.updatedAt ?? null };
    }
  }
  return { dto: buildStatusDTO(row, { nowMs, comparison, bank }), row, etag: statusEtag(probe, nowMs) };
}

// ── /review/[ref]/complete (§5.3) ────────────────────────────────────────────────────────────────────────────────
/** The first instant of the viewer's calendar month (viewer.timeZone ?? "UTC"; users have no time zone until P4). */
export function monthStartUtc(nowMs: number): Date {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** `max(accuracy)` of the viewer's games this month (game_players_userId_endedAt_gameId_idx prefix). */
export function bestThisMonthSql(userId: bigint, nowMs: number): Prisma.Sql {
  return Prisma.sql`SELECT max(accuracy) AS best FROM game_players
   WHERE "userId" = ${userId} AND "endedAt" >= ${monthStartUtc(nowMs).toISOString()}::timestamptz AT TIME ZONE 'UTC'`;
}

/** True when this game's accuracy is the viewer's best this month (ties count). */
export function isBestThisMonth(accuracy: number | null, endedAt: Date | null, best: number | null, nowMs: number): boolean {
  if (accuracy == null || endedAt == null || best == null) return false;
  if (new Date(endedAt).getTime() < monthStartUtc(nowMs).getTime()) return false;
  // Both sides are the same real column read through the same driver; the epsilon only absorbs float noise.
  return accuracy >= best - 1e-6;
}

/**
 * The complete page view (RSC only): the review payload's tables and the best-this-month query in one Promise.all.
 * A direct visit before Finish Review renders `partial`.
 */
export async function getReviewComplete(
  db: GamesDb,
  viewer: ViewerRef,
  ref: string,
  nowMs: number,
  options: { shareEnabled: boolean } & ReadBankOption,
): Promise<ReviewCompleteView> {
  const bank = await bankOn(viewer, options);
  const [row, bestRows] = await Promise.all([
    loadReviewRow(db, viewer, ref, { bank }),
    db.$queryRaw<{ best: number | null }[]>(bestThisMonthSql(viewer.id, nowMs)),
  ]);
  if (!row) throw new DataError("not_found");
  const ctx = bank ? bankContextOf(viewer, nowMs) : undefined;
  const dto = buildReviewDTO(row, { nowMs, siteOrigin: siteOrigin(), ...(ctx ? { bank: ctx } : {}) });
  if (dto.status !== "done" || !dto.review) throw new DataError("conflict", { details: { reason: "analysis_not_done" } });
  const best = row.isPlayer ? (bestRows[0]?.best ?? null) : null;
  const bankInput = bankInputOf(row, ctx);
  return buildCompleteView(dto, {
    bestThisMonth: row.isPlayer && isBestThisMonth(row.myAccuracy, row.playedAt, best, nowMs),
    shareEnabled: options.shareEnabled,
    ...(bankInput ? { bank: bankInput } : {}),
  });
}
