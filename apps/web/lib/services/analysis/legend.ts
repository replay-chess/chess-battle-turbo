// Compare with the legend: A9 getLegendCompare and A9b computeLegend (phase-03 plan §4.6, §5.7, §7.2, §7.3, §8.9;
// P3-D23, P3-D24).
//
// A9 reads the facts row (one statement); when it is missing it computes the facts with the pure CA functions and
// inserts them (`legend_facts`, ON CONFLICT DO NOTHING). It never enqueues engine work, so a hover prefetch is safe.
// A game without a comparable legend position (no position, no name on the member's side, a PGN that never reaches
// the start, an unknown legend result) is 404: the compare page 308s back to the review instead.
//
// A9b ensures the facts row the same way, then one statement bumps `attempts` (≤ LEGEND_COMPUTE_MAX_ATTEMPTS, a
// FAILED row goes back to FACTS_READY) and, in a CTE guarded by that bump, requeues the LEGEND_COMPARE job
// (`legend:<gameId>:<userId>`). 0 rows → READY 409 already_ready · attempts used 410 gone.
import { moveLabel } from "@repo/chess-analysis/codec";
import { comparisonParagraph, lineRows, outcomeLine, summaryLine } from "@repo/chess-analysis/legend/summary";
import { outcomeForMember } from "@repo/chess-analysis/legend/slice";
import {
  LEGEND_COMPUTE_MAX_ATTEMPTS,
  StaticExplanation,
  type LegendCompareDTO,
} from "@repo/contracts/http/legend";
import { PRACTICE_BOT_ELO, practiceFromGamePath } from "@repo/contracts/http/practice";
import { JOB_PRIORITY, legendDedupeKey } from "@repo/contracts/internal/jobs";
import { Prisma } from "@repo/db";
import { enqueueJobSql } from "@repo/db/jobs";
import { parseComparisonFacts, type ComparisonFactsV1 } from "@repo/db/json";
import { ApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import type { GamesDb } from "@/lib/games/snapshot.server";
import { historicalFullName, historicalShortName, insertLegendFactsSql, legendFactsFor, type FactsRowState } from "./legend-facts";
import { kickWorker } from "./kick";
import { isAdmin } from "./reader";
import { playerCardsOf, replayMoves } from "./review-dto";
import { reviewReadSql, type LegendRow } from "./review-sql";
import { analysisStateOf } from "./state";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;

export type LegendRead = {
  row: LegendRow;
  facts: ComparisonFactsV1;
  status: FactsRowState["status"];
  attempts: number;
  updatedAt: Date;
};

/** The legend read (one statement). DataError not_found for an unknown game, a non-player or no legend position. */
export async function readLegendRow(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role">,
  ref: string,
  options: { includeExplanation: boolean },
): Promise<LegendRow> {
  const rows = await db.$queryRaw<LegendRow[]>(
    reviewReadSql("legend", { viewerId: viewer.id, ref, admin: isAdmin(viewer), includeExplanation: options.includeExplanation }),
  );
  const row = rows[0];
  if (!row || row.chessPositionId == null) throw new DataError("not_found");
  return row;
}

/** The row's facts, inserting them when missing (`legend_facts`). DataError not_found when there is no comparison. */
export async function ensureLegendFacts(db: GamesDb, row: LegendRow): Promise<LegendRead> {
  if (row.comparisonStatus) {
    const facts = parseComparisonFacts(row.comparisonFacts);
    if (!facts) throw new DataError("not_found");
    return {
      row,
      facts,
      status: row.comparisonStatus,
      attempts: row.comparisonAttempts ?? 0,
      updatedAt: row.comparisonUpdatedAt ?? new Date(0),
    };
  }
  if (row.gameStatus !== "COMPLETED") throw new DataError("not_found");
  const facts = legendFactsFor({ ...row, startFen: row.startingFen, member: row.color });
  if (!facts) throw new DataError("not_found");
  const inserted = await db.$queryRaw<FactsRowState[]>(
    insertLegendFactsSql({ gameId: row.gameId, userId: row.memberId, chessPositionId: row.chessPositionId, facts }),
  );
  const state = inserted[0];
  return {
    row,
    facts: (state && parseComparisonFacts(state.facts)) || facts,
    status: state?.status ?? "FACTS_READY",
    attempts: state?.attempts ?? 0,
    updatedAt: state?.updatedAt ?? row.playedAt,
  };
}

/** A9 / the compare RSC: the row and its facts. */
export async function getLegendCompare(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role">,
  ref: string,
  options: { includeExplanation: boolean },
): Promise<LegendRead> {
  return ensureLegendFacts(db, await readLegendRow(db, viewer, ref, options));
}

const STATUS_WIRE = { FACTS_READY: "facts_ready", NARRATING: "narrating", READY: "ready", FAILED: "failed" } as const;

function yearOf(row: LegendRow): number | null {
  if (row.eventDate) return new Date(row.eventDate).getUTCFullYear();
  const meta = row.metaPosition as { year?: unknown } | null;
  return typeof meta?.year === "number" && Number.isInteger(meta.year) ? meta.year : null;
}

function titleOf(row: LegendRow, fullName: string, year: number | null): string {
  const meta = row.metaPosition as { name?: unknown; event?: unknown } | null;
  const event = row.tournamentName?.trim() || (typeof meta?.event === "string" ? meta.event.trim() : "");
  if (event) return (year && !event.includes(String(year)) ? `${event} ${year}` : event).slice(0, 160);
  if (typeof meta?.name === "string" && meta.name.trim()) return meta.name.trim().slice(0, 160);
  return `${fullName}${year ? `, ${year}` : ""}`.slice(0, 160);
}

function audioUrlOf(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function legendCompareEtag(read: LegendRead, include: boolean, nowMs: number): string {
  const state = analysisStateOf(read.row, nowMs);
  return `l1-${read.status}-${new Date(read.updatedAt).getTime()}-${read.attempts}-${state.status}-${include ? "e" : "n"}`;
}

/** LegendCompareDTO (A9 and the compare RSC). */
export function buildLegendCompareDTO(read: LegendRead, opts: { include: boolean; nowMs: number }): LegendCompareDTO {
  const { row, facts } = read;
  const side = row.color;
  const other = side === "w" ? "b" : "w";
  const fullName = historicalFullName(row, side) ?? facts.historicalName;
  const otherFull = historicalFullName(row, other);
  const year = yearOf(row);
  const ctx = { startFen: row.startingFen, facts };
  const userResult = outcomeForMember(row.outcome, side) ?? "draw";
  const userLine = facts.userLineUci === "" ? [] : facts.userLineUci.split(" ");
  const legendLine = facts.legendLineUci === "" ? [] : facts.legendLineUci.split(" ");
  const players = playerCardsOf(row, otherFull !== null);
  let divergence: LegendCompareDTO["divergence"] = null;
  if (facts.divergencePly !== null && facts.divergenceBy && facts.userUci && facts.userSan && facts.legendUci && facts.legendSan) {
    const fens = replayMoves(row.startingFen, userLine.slice(0, facts.divergencePly).join(" ")).fens;
    const fenBefore = fens[facts.divergencePly];
    if (fenBefore) {
      divergence = {
        ply: facts.divergencePly,
        moveLabel: moveLabel(facts.divergencePly, facts.startPly),
        by: facts.divergenceBy,
        userUci: facts.userUci,
        userSan: facts.userSan,
        legendUci: facts.legendUci,
        legendSan: facts.legendSan,
        fenBefore,
      };
    }
  }
  const lastCompared = Math.max(0, Math.min(userLine.length, legendLine.length) - 1);
  const practicePly = facts.divergencePly ?? lastCompared;
  const explanation =
    opts.include && row.hasExplanation && row.explanation != null ? StaticExplanation.safeParse(row.explanation) : null;
  return {
    v: 1,
    ref: row.ref,
    status: STATUS_WIRE[read.status],
    attempts: Math.min(LEGEND_COMPUTE_MAX_ATTEMPTS, Math.max(0, read.attempts)),
    analysisStatus: analysisStateOf(row, opts.nowMs).status,
    legend: {
      name: facts.historicalName,
      fullName: fullName.slice(0, 120),
      year,
      title: titleOf(row, fullName, year),
      positionRef: row.positionRef ?? row.ref,
    },
    you: side,
    players,
    startFen: row.startingFen,
    startPly: row.startPly,
    matched: facts.matchedPlies,
    compared: facts.comparedPlies,
    divergence,
    evalAtDivergence: facts.evalAtDivergence,
    legendResult: facts.legendResult,
    legendTotalMoves: facts.legendTotalMoves && facts.legendTotalMoves >= 1 ? facts.legendTotalMoves : null,
    userResult,
    summaryLine: summaryLine(facts).slice(0, 200),
    paragraph: comparisonParagraph(facts, {
      opponentLabel: players[other].kind === "bot" ? "The engine" : "Your opponent",
      opponentHistoricalName: otherFull ? historicalShortName(otherFull) : null,
    }).slice(0, 600),
    outcomeLine: outcomeLine(facts, userResult).slice(0, 120),
    yourLine: { uci: facts.userLineUci, rows: lineRows(ctx, "yours") },
    legendLine: { uci: facts.legendLineUci, rows: lineRows(ctx, "legend") },
    practice: { ply: practicePly, href: practiceFromGamePath(row.ref, practicePly), botElo: PRACTICE_BOT_ELO },
    hasExplanation: row.hasExplanation === true,
    explanation: explanation?.success ? explanation.data : null,
    audioUrl: audioUrlOf(row.explanationAudioUrl),
    updatedAt: new Date(read.updatedAt).toISOString(),
  };
}

// ── A9b ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function computeLegendSql(input: { gameId: bigint; userId: bigint; gameRef: string }): Prisma.Sql {
  const job = enqueueJobSql({
    kind: "LEGEND_COMPARE",
    priority: JOB_PRIORITY.USER_OPENED,
    payload: { v: 1, gameId: input.gameId.toString(), userId: input.userId.toString(), gameRef: input.gameRef },
    dedupeKey: legendDedupeKey(input.gameId, input.userId),
    gameId: input.gameId,
    userId: input.userId,
    onConflict: "requeue",
    when: Prisma.sql`EXISTS (SELECT 1 FROM lc)`,
  });
  return Prisma.sql`WITH lc AS (
  UPDATE legend_comparisons SET attempts = attempts + 1,
         status = CASE WHEN status = 'FAILED' THEN 'FACTS_READY'::"ComparisonStatus" ELSE status END,
         "updatedAt" = ${NOW}
   WHERE "gameId" = ${input.gameId} AND "userId" = ${input.userId}
     AND status <> 'READY' AND attempts < ${LEGEND_COMPUTE_MAX_ATTEMPTS}
  RETURNING attempts
), j AS (
  ${job}
)
SELECT (SELECT count(*) FROM lc)::int AS bumped, (SELECT count(*) FROM j)::int AS queued`;
}

export type ComputeOutcome = "computing" | "admin_noop";

/** A9b. */
export async function computeLegend(
  db: GamesDb,
  viewer: Pick<Viewer, "id" | "role">,
  ref: string,
  ctx: { after: (task: () => unknown) => void; now: Date },
): Promise<ComputeOutcome> {
  const row = await readLegendRow(db, viewer, ref, { includeExplanation: false });
  if (!row.isPlayer) return "admin_noop";
  const read = await ensureLegendFacts(db, row);
  if (read.status === "READY") throw new ApiError("conflict", { details: { reason: "already_ready" } });
  if (analysisStateOf(read.row, ctx.now.getTime()).status !== "done") {
    throw new ApiError("conflict", { details: { reason: "analysis_not_done" } });
  }
  const rows = await db.$queryRaw<{ bumped: number; queued: number }[]>(
    computeLegendSql({ gameId: read.row.gameId, userId: read.row.memberId, gameRef: read.row.ref }),
  );
  if (Number(rows[0]?.bumped ?? 0) === 0) {
    const again = await db.$queryRaw<{ status: string; attempts: number }[]>(
      Prisma.sql`SELECT status::text AS status, attempts FROM legend_comparisons WHERE "gameId" = ${read.row.gameId} AND "userId" = ${read.row.memberId}`,
    );
    const lc = again[0];
    if (!lc) throw new DataError("not_found");
    if (lc.status === "READY") throw new ApiError("conflict", { details: { reason: "already_ready" } });
    throw new ApiError("gone", { details: { reason: "attempts_used", attempts: Number(lc.attempts) } });
  }
  ctx.after(() => kickWorker({ v: 1, reason: "opened", kinds: ["LEGEND_COMPARE"], watch: read.row.ref }));
  return "computing";
}
