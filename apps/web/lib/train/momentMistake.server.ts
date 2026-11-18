// A6 on a game side that was never extracted (browser pass D1): the member's "Add this position to my Mistake Bank"
// creates that moment's mistake and occurrence on demand, so the card A6 then creates is real and the response, the
// toast, the review read and Review complete agree.
//
// Such a side exists while the B-M5-1 backfill has not reached a game analysed before P5 (or one analysed while the
// worker's BANK_EXTRACT_ENABLED kill switch was off): `game_players."bankVersion"` is 0 and the side has no occurrence
// rows. Everything a mistake needs is stored: the game's moves, its `game_analyses` arrays and lines and the side's key
// moments, so the row comes from the SAME extraction as J1 and the EXTRACT_MISTAKES job (@repo/chess-training/extract),
// only without the engine: a scored puzzle keeps its first move as the line, exactly as the worker keeps it when a line
// search fails. `bankVersion` stays 0, so the backfill still runs for the side later and refreshes the row with its
// engine line (its upsert overwrites the solution, accept, themes and puzzle fields; ON CONFLICT on the position).
// P6 (phase-06 plan §8.12): the game's clocks go into the extraction, so a moment played with under a minute on the
// clock carries `rc:timePressure`, and an existing row of the same position gains the tag (a union, never removed).
//
// Only the toggled moment is written: the member asked for one position, not for the game's other key moments.
// A moment the extraction cannot bank (no stored best move, a legacy game whose sides are unknown, an analysis that is
// not complete) is null: A6 answers 409 `not_bankable` and nothing changes (the transaction rolls back).
import { Prisma } from "@repo/db";
import { newGameRef } from "@repo/db/games";
import type { StoredLine } from "@repo/chess-analysis/analysis";
import { replayUci, type Replay } from "@repo/chess-analysis/replay";
import { buildBankPlan, type ExtractTraining, type MistakeRow, type OccurrenceRow } from "@repo/chess-training/extract";
import type { TrainingProfile } from "./profile.server";
import { NOW_UTC, type TrainDb } from "./db.server";

/** The side's stored game and analysis (one statement; PK lookups). */
export function momentExtractSql(gameId: bigint, userId: bigint): Prisma.Sql {
  return Prisma.sql`SELECT g."startingFen", g."startPly", g.moves, g."analysisStatus"::text AS "analysisStatus",
      (extract(epoch FROM g."completedAt") * 1000)::float8 AS "completedAtMs", g."ecoCode", g."timeClass"::text AS "timeClass",
      g."moveClocksMs", g."initialTimeSeconds",
      COALESCE(g.meta ? 'colorUnknown', false) AS "colorUnknown",
      a.evals, a.second, a.best, a.judgements, a.lines, a."middlegamePly", a."endgamePly", (a."completedAt" IS NOT NULL) AS "analysisDone",
      gp.color, u."referenceId" AS "userRef", (extract(epoch FROM gp."endedAt") * 1000)::float8 AS "endedAtMs", gp."opponentName",
      COALESCE(jsonb_path_query_array(pr.content, '$.moments[*].ply'), '[]'::jsonb) AS moments
    FROM games g
    JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = ${userId}
    JOIN users u ON u.id = gp."userId"
    LEFT JOIN game_analyses a ON a."gameId" = g.id
    LEFT JOIN player_reviews pr ON pr."gameId" = g.id AND pr.color = gp.color
    WHERE g.id = ${gameId}`;
}

type ExtractRow = {
  startingFen: string;
  startPly: number | null;
  moves: string | null;
  analysisStatus: string;
  completedAtMs: number | null;
  ecoCode: string | null;
  timeClass: string | null;
  /** P6 (phase-06 plan §8.12): the clocks behind `rc:timePressure`. */
  moveClocksMs: number[] | null;
  initialTimeSeconds: number | null;
  colorUnknown: boolean;
  evals: number[] | null;
  second: number[] | null;
  best: number[] | null;
  judgements: number[] | null;
  lines: unknown;
  middlegamePly: number | null;
  endgamePly: number | null;
  analysisDone: boolean | null;
  color: string;
  userRef: string;
  endedAtMs: number | null;
  opponentName: string | null;
  moments: unknown;
};

const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => Number(x)) : []);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

export type MomentRows = { mistake: MistakeRow; occurrence: OccurrenceRow };

/** The moment's mistake and occurrence rows, or null when the extraction does not bank this ply. Pure. */
export async function momentRowsOf(
  row: ExtractRow | undefined,
  input: { gameId: bigint; userId: bigint; ply: number; now: Date; timeZone: string; profile: Pick<TrainingProfile, "dayStartHour" | "releaseHour" | "bankDailyCap" | "newPerDay"> },
): Promise<MomentRows | null> {
  if (!row || row.analysisStatus !== "DONE" || row.analysisDone !== true || row.colorUnknown) return null;
  const color = row.color === "w" || row.color === "b" ? row.color : null;
  if (!color) return null;
  const moves = typeof row.moves === "string" && row.moves.trim() !== "" ? row.moves.trim().split(/\s+/) : [];
  let replay: Replay;
  try {
    replay = replayUci(String(row.startingFen), moves);
  } catch {
    return null;
  }
  const evals = nums(row.evals);
  const judgements = nums(row.judgements);
  if (evals.length !== replay.uci.length + 1 || judgements.length !== replay.uci.length) return null;
  const moments = nums(typeof row.moments === "string" ? JSON.parse(row.moments) : row.moments);
  if (!moments.includes(input.ply)) return null;
  const training: ExtractTraining = {
    timeZone: input.timeZone,
    dayStartHour: input.profile.dayStartHour,
    releaseHour: input.profile.releaseHour,
    bankDailyCap: input.profile.bankDailyCap,
    newPerDay: input.profile.newPerDay,
    endedAtMs: typeof row.endedAtMs === "number" ? row.endedAtMs : null,
    opponentName: row.opponentName,
    dayAnchor: null,
  };
  const plan = await buildBankPlan(
    {
      gameId: input.gameId.toString(),
      startPly: Number(row.startPly ?? 0),
      replay,
      evals,
      second: nums(row.second),
      best: nums(row.best),
      judgements,
      lines: row.lines && typeof row.lines === "object" ? (row.lines as Record<string, StoredLine>) : {},
      division: { middlegamePly: intOrNull(row.middlegamePly), endgamePly: intOrNull(row.endgamePly) },
      moments: { [color]: moments },
      members: [{ color, userId: input.userId.toString(), userRef: row.userRef, training }],
      completedAtMs: typeof row.completedAtMs === "number" ? row.completedAtMs : null,
      timeClass: row.timeClass,
      ecoCode: row.ecoCode,
      colorUnknown: false,
      moveClocksMs: nums(row.moveClocksMs),
      initialTimeSeconds: typeof row.initialTimeSeconds === "number" ? row.initialTimeSeconds : null,
      now: input.now,
    },
    { search: null, reply: null, newRef: newGameRef },
    { source: "backfill", clockMs: () => input.now.getTime() },
  );
  const occurrence = plan.occurrences.find((o) => o.ply === input.ply);
  if (!occurrence) return null;
  const mistake = plan.mistakes.find((m) => m.epdHash === occurrence.epdHash);
  return mistake ? { mistake, occurrence } : null;
}

/**
 * Writes the moment's mistake (insert; an existing row of the same position, from another game, is un-hidden and
 * takes this game as its newest occurrence when it is newer, as the worker's statement 1 does) and its occurrence,
 * then recounts the mistake's occurrences. Three statements in the caller's transaction.
 */
export async function writeMomentMistake(db: TrainDb, rows: MomentRows): Promise<void> {
  const m = rows.mistake;
  await db.$executeRaw(Prisma.sql`INSERT INTO mistakes ("referenceId", "userId", "epdHash", color, fen, "setupUci", solution, accept,
      "playedUci", "refuteUci", judgement, source, "isPuzzle", "uniquenessGap", themes, "primaryTheme", phase, "winBefore",
      "winAfterPlayed", "cpBest", "mateBest", "timeClass", "ecoCode", "moveNumber", "lastGameId", "lastPly", "lastPlayedAt",
      "lastOpponentName", "createdAt", "updatedAt")
    VALUES (${m.referenceId}, ${BigInt(m.userId)}, ${BigInt(m.epdHash)}, ${m.color}, ${m.fen}, ${m.setupUci}, ${m.solution}, ${m.accept},
      ${m.playedUci}, ${m.refuteUci}, ${m.judgement}::"Judgement", ${m.source}::"MistakeSource", ${m.isPuzzle}, ${m.uniquenessGap}::real,
      ${m.themes}::text[], ${m.primaryTheme}, ${m.phase}::"GamePhase", ${m.winBefore}::real, ${m.winAfterPlayed}::real, ${m.cpBest}::int,
      ${m.mateBest}::smallint, ${m.timeClass}::"TimeClass", ${m.ecoCode}, ${m.moveNumber}::smallint, ${BigInt(m.lastGameId)}, ${m.lastPly}::smallint,
      ${m.lastPlayedAt}::timestamp(3), ${m.lastOpponentName}, ${NOW_UTC}, ${NOW_UTC})
    ON CONFLICT ("userId", "epdHash") DO UPDATE
      SET "hiddenAt" = NULL, "updatedAt" = EXCLUDED."updatedAt",
          themes = CASE WHEN 'rc:timePressure' = ANY(EXCLUDED.themes) AND NOT ('rc:timePressure' = ANY(mistakes.themes))
                        THEN array_append(mistakes.themes, 'rc:timePressure') ELSE mistakes.themes END,
          "lastGameId" = CASE WHEN EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt" THEN EXCLUDED."lastGameId" ELSE mistakes."lastGameId" END,
          "lastPly" = CASE WHEN EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt" THEN EXCLUDED."lastPly" ELSE mistakes."lastPly" END,
          "lastOpponentName" = CASE WHEN EXCLUDED."lastPlayedAt" >= mistakes."lastPlayedAt" THEN EXCLUDED."lastOpponentName" ELSE mistakes."lastOpponentName" END,
          "lastPlayedAt" = GREATEST(EXCLUDED."lastPlayedAt", mistakes."lastPlayedAt")`);
  await db.$executeRaw(Prisma.sql`INSERT INTO mistake_occurrences ("gameId", ply, "mistakeId")
    SELECT ${BigInt(rows.occurrence.gameId)}, ${rows.occurrence.ply}::smallint, m.id FROM mistakes m
     WHERE m."userId" = ${BigInt(m.userId)} AND m."epdHash" = ${BigInt(m.epdHash)}
    ON CONFLICT DO NOTHING`);
  await db.$executeRaw(Prisma.sql`UPDATE mistakes m SET occurrences = (SELECT count(*) FROM mistake_occurrences o WHERE o."mistakeId" = m.id)::smallint
    WHERE m."userId" = ${BigInt(m.userId)} AND m."epdHash" = ${BigInt(m.epdHash)}`);
}

/** Loads the side, extracts the moment and writes its rows. False: this moment cannot go to the bank. */
export async function addMomentMistake(
  db: TrainDb,
  input: { gameId: bigint; userId: bigint; ply: number; now: Date; timeZone: string; profile: Pick<TrainingProfile, "dayStartHour" | "releaseHour" | "bankDailyCap" | "newPerDay"> },
): Promise<boolean> {
  const rows = await momentRowsOf((await db.$queryRaw<ExtractRow[]>(momentExtractSql(input.gameId, input.userId)))[0], input);
  if (!rows) return false;
  await writeMomentMistake(db, rows);
  return true;
}
