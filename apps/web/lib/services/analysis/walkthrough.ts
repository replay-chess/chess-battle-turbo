// The walkthrough writes (phase-03 plan §7.2 A5 / A6 / A7, §7.3 recordProgress / setMomentBank / completeReview).
// Each is ONE statement on the viewer's own player_reviews row (the player check is the `me` CTE), so a non-player
// can never write; a non-player admin's write is a 204 no-op, anyone else gets 404. Every write sets "updatedAt"
// itself (Prisma's @updatedAt is client-side), which moves the A1 ETag.
//
// A5 merges through the SQL function review_progress_merge() (M3), which is monotonic: momentIndex never goes back,
// an existing moment result is never overwritten, attempts keep the per-ply max (≤ 50), the latest plan chip wins.
// The route reduces the event batch here first: events are deduped by (type, ply, at) and replayed in time order per
// moment ply; only plies that are key moments of this review are kept. Attempt counts are cumulative on the server
// (stored + this batch's new attempts) and freeze once the moment has a result; a moment's result is FOUND only when
// no wrong attempt came before the correct one (stored attempts included), else FOUND_RETRY; REVEALED when the line
// was revealed first.
import type { CompleteOut, PlanKey, ProgressBody, ProgressEvent } from "@repo/contracts/http/review";
import { Prisma } from "@repo/db";
import { parseReviewContent, parseReviewProgress } from "@repo/db/json";
import type { Viewer } from "@/lib/auth/viewer";
import { ApiError } from "@/lib/api/api-error";
import { DataError } from "@/lib/data/errors";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { bestThisMonthSql, isBestThisMonth } from "./read";
import { isAdmin } from "./reader";
import { completeOutOf } from "./review-dto";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
const EMPTY_PROGRESS = Prisma.sql`'{"v":1,"momentIndex":0,"results":{},"attempts":{},"planChips":{},"bankOptOut":[]}'::jsonb`;

const ME = (viewerId: bigint, ref: string) => Prisma.sql`me AS (
  SELECT g.id, gp.color, gp.accuracy, gp."endedAt", g."analysisStatus"::text AS "analysisStatus"
    FROM games g JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${viewerId}
   WHERE g."referenceId" = ${ref})`;

/** After a 0-player write: a non-player admin gets the no-op, everyone else 404. */
async function adminNoopOrNotFound(db: GamesDb, viewer: Pick<Viewer, "role">, ref: string): Promise<"admin_noop"> {
  if (isAdmin(viewer)) {
    const rows = await db.$queryRaw<unknown[]>(Prisma.sql`SELECT 1 FROM games WHERE "referenceId" = ${ref}`);
    if (rows.length) return "admin_noop";
  }
  throw new DataError("not_found");
}

// ── A5 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export type MomentOutcome = { r: "FOUND" | "REVEALED"; w: number };
export type ProgressPatchInput = {
  /** ply → the first terminal event and the wrong attempts before it. */
  outcomes: Record<string, MomentOutcome>;
  /** ply → attempts in this batch up to the terminal event. */
  attempts: Record<string, number>;
  /** ply → the last chip picked. */
  planChips: Record<string, PlanKey>;
};

/** Reduces an A5 event batch (dedupe by type/ply/at, time order) into the patch the statement merges. */
export function reduceProgressEvents(events: readonly ProgressEvent[]): ProgressPatchInput {
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    const key = `${e.type}|${e.ply}|${e.at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ordered = unique.map((e, i) => ({ e, i })).sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i);
  const out: ProgressPatchInput = { outcomes: {}, attempts: {}, planChips: {} };
  const wrong: Record<string, number> = {};
  for (const { e } of ordered) {
    const ply = String(e.ply);
    const settled = out.outcomes[ply] !== undefined;
    switch (e.type) {
      case "attempt":
        if (settled) break;
        out.attempts[ply] = (out.attempts[ply] ?? 0) + 1;
        if (e.correct === true) out.outcomes[ply] = { r: "FOUND", w: wrong[ply] ?? 0 };
        else wrong[ply] = (wrong[ply] ?? 0) + 1;
        break;
      case "revealed":
        if (!settled) out.outcomes[ply] = { r: "REVEALED", w: wrong[ply] ?? 0 };
        break;
      case "plan_picked":
        if (e.chip) out.planChips[ply] = e.chip;
        break;
      case "viewed":
      case "show_line":
        break;
    }
  }
  return out;
}

/**
 * The A5 statement. The patch is built in SQL from the stored row, so the attempt sums and FOUND / FOUND_RETRY see the
 * stored counts; keys outside the review's moment plies are dropped. Returns `player` (the viewer's game_players row
 * exists) and `updated` (a review row was merged).
 */
export function recordProgressSql(viewerId: bigint, ref: string, momentIndex: number, patch: ProgressPatchInput): Prisma.Sql {
  return Prisma.sql`WITH ${ME(viewerId, ref)},
patch AS (SELECT ${JSON.stringify(patch.outcomes)}::jsonb AS outcomes, ${JSON.stringify(patch.attempts)}::jsonb AS attempts,
                 ${JSON.stringify(patch.planChips)}::jsonb AS chips),
up AS (
  UPDATE player_reviews pr SET
    progress = review_progress_merge(pr.progress, jsonb_build_object(
      'results', COALESCE((
        SELECT jsonb_object_agg(o.key, CASE
                 WHEN o.value->>'r' = 'REVEALED' THEN 'REVEALED'
                 WHEN COALESCE((pr.progress->'attempts'->>o.key)::int, 0) + (o.value->>'w')::int > 0 THEN 'FOUND_RETRY'
                 ELSE 'FOUND' END)
          FROM patch, jsonb_each(patch.outcomes) o
         WHERE o.key IN (SELECT m->>'ply' FROM jsonb_array_elements(pr.content->'moments') m)), '{}'::jsonb),
      'attempts', COALESCE((
        SELECT jsonb_object_agg(a.key, LEAST(50, COALESCE((pr.progress->'attempts'->>a.key)::int, 0) + a.value::int))
          FROM patch, jsonb_each_text(patch.attempts) a
         WHERE a.key IN (SELECT m->>'ply' FROM jsonb_array_elements(pr.content->'moments') m)
           AND NOT COALESCE(pr.progress->'results' ? a.key, false)), '{}'::jsonb),
      'planChips', COALESCE((
        SELECT jsonb_object_agg(c.key, c.value)
          FROM patch, jsonb_each(patch.chips) c
         WHERE c.key IN (SELECT m->>'ply' FROM jsonb_array_elements(pr.content->'moments') m)), '{}'::jsonb)
    ), ${momentIndex}::int),
    "startedAt" = COALESCE(pr."startedAt", ${NOW}),
    "updatedAt" = ${NOW}
  FROM me
  WHERE pr."gameId" = me.id AND pr.color = me.color AND pr.content IS NOT NULL
  RETURNING 1
)
SELECT (SELECT count(*) FROM me)::int AS player, (SELECT count(*) FROM up)::int AS updated`;
}

export type WriteOutcome = "ok" | "admin_noop";

/** A5. 409 analysis_not_done when the review is not written yet. */
export async function recordProgress(db: GamesDb, viewer: Pick<Viewer, "id" | "role">, ref: string, body: ProgressBody): Promise<WriteOutcome> {
  const patch = reduceProgressEvents(body.events);
  const rows = await db.$queryRaw<{ player: number; updated: number }[]>(recordProgressSql(viewer.id, ref, body.momentIndex, patch));
  const r = rows[0];
  if (!r || Number(r.player) === 0) return adminNoopOrNotFound(db, viewer, ref);
  if (Number(r.updated) === 0) throw new ApiError("conflict", { details: { reason: "analysis_not_done" } });
  return "ok";
}

// ── A6 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function setMomentBankSql(viewerId: bigint, ref: string, ply: number, inBank: boolean): Prisma.Sql {
  const optOut = Prisma.sql`COALESCE(pr.progress->'bankOptOut', '[]'::jsonb)`;
  const next = inBank
    ? Prisma.sql`(SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM jsonb_array_elements(${optOut}) x WHERE x <> to_jsonb(${ply}::int))`
    : Prisma.sql`(SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb)
                    FROM (SELECT jsonb_array_elements(${optOut}) UNION ALL SELECT to_jsonb(${ply}::int)) t(x))`;
  return Prisma.sql`WITH ${ME(viewerId, ref)},
rv AS (
  SELECT pr."gameId", pr.color,
         EXISTS (SELECT 1 FROM jsonb_array_elements(pr.content->'moments') m WHERE (m->>'ply')::int = ${ply}) AS moment
    FROM player_reviews pr JOIN me ON pr."gameId" = me.id AND pr.color = me.color
   WHERE pr.content IS NOT NULL
),
up AS (
  UPDATE player_reviews pr SET progress = jsonb_set(COALESCE(pr.progress, ${EMPTY_PROGRESS}), '{bankOptOut}', ${next}),
         "updatedAt" = ${NOW}
    FROM rv WHERE pr."gameId" = rv."gameId" AND pr.color = rv.color AND rv.moment
  RETURNING 1
)
SELECT (SELECT count(*) FROM me)::int AS player, (SELECT count(*) FROM rv)::int AS reviewed,
       (SELECT count(*) FROM up)::int AS updated`;
}

/** A6. 404 for a ply that is not a key moment of this review. */
export async function setMomentBank(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role">,
  ref: string,
  ply: number,
  inBank: boolean,
): Promise<WriteOutcome> {
  const rows = await db.$queryRaw<{ player: number; reviewed: number; updated: number }[]>(setMomentBankSql(viewer.id, ref, ply, inBank));
  const r = rows[0];
  if (!r || Number(r.player) === 0) return adminNoopOrNotFound(db, viewer, ref);
  if (Number(r.reviewed) === 0) throw new ApiError("conflict", { details: { reason: "analysis_not_done" } });
  if (Number(r.updated) === 0) throw new DataError("not_found", { message: "That move is not a key moment of this review." });
  return "ok";
}

// ── A7 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** completedAt is set once (COALESCE); a replay returns the same timestamp and body. */
export function completeReviewSql(viewerId: bigint, ref: string): Prisma.Sql {
  return Prisma.sql`WITH ${ME(viewerId, ref)},
up AS (
  UPDATE player_reviews pr SET "completedAt" = COALESCE(pr."completedAt", ${NOW}),
         "updatedAt" = CASE WHEN pr."completedAt" IS NULL THEN ${NOW} ELSE pr."updatedAt" END
    FROM me
   WHERE pr."gameId" = me.id AND pr.color = me.color AND me."analysisStatus" = 'DONE' AND pr.content IS NOT NULL
  RETURNING pr."completedAt", pr.content, pr.progress
)
SELECT (SELECT count(*) FROM me)::int AS player, me.accuracy, me."endedAt", up."completedAt", up.content, up.progress
  FROM (SELECT 1) one LEFT JOIN me ON true LEFT JOIN up ON true`;
}

export type CompleteOutcome = { body: CompleteOut } | "admin_noop";

/** A7: the update and the best-this-month read in one Promise.all. 409 analysis_not_done before the review exists. */
export async function completeReview(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role">,
  ref: string,
  nowMs: number,
): Promise<CompleteOutcome> {
  type Row = { player: number; accuracy: number | null; endedAt: Date | null; completedAt: Date | null; content: unknown; progress: unknown };
  const [rows, bestRows] = await Promise.all([
    db.$queryRaw<Row[]>(completeReviewSql(viewer.id, ref)),
    db.$queryRaw<{ best: number | null }[]>(bestThisMonthSql(viewer.id, nowMs)),
  ]);
  const r = rows[0];
  if (!r || Number(r.player) === 0) return adminNoopOrNotFound(db, viewer, ref);
  const content = parseReviewContent(r.content);
  if (!r.completedAt || !content) throw new ApiError("conflict", { details: { reason: "analysis_not_done" } });
  return {
    body: completeOutOf({
      accuracy: r.accuracy,
      content,
      progress: parseReviewProgress(r.progress) ?? parseReviewProgress(null)!,
      bestThisMonth: isBestThisMonth(r.accuracy, r.endedAt, bestRows[0]?.best ?? null, nowMs),
      completedAt: new Date(r.completedAt),
    }),
  };
}
