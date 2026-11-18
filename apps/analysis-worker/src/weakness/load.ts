// RECOMPUTE_WEAKNESS step 3 (phase-06 plan §7.4.2, Q-W5): the member's candidate game sides, newest first, at most
// 300, in ONE statement on `game_players_userId_endedAt_gameId_idx` + `games_pkey` (+ `game_analyses_pkey` for the
// eval source the engine's calibration reads and the first analysis time `weakness_first_ready` reports). Bot games,
// aborted games, other time classes, games before the window and (FIX-1) imported games against a BOT-titled account
// (R-LI-09) are all filtered in SQL BEFORE the 300 limit, as the plan's §8.2 and coverage.ts / TR-5 count them: the
// newest 300 human games, never fewer because bot imports took places. computeWeakness's own BOT filter stays for other
// callers (`metrics.games.excludedBot` is 0 on the worker's snapshots: those rows never reach it).
import type { WeaknessGameInput } from "@repo/chess-training/weakness/types";
import { idStr, num, numOrNull, stmt, type Db, type Row, type Statement } from "../db/client";

/** The scope's game limit (MAX_GAMES). */
export const INPUTS_LIMIT = 300;

export function weaknessInputsStatement(userId: string, since: Date, timeClasses: readonly string[]): Statement {
  return stmt(
    `SELECT gp."gameId"::text AS "gameId", gp.color, (extract(epoch FROM gp."endedAt") * 1000)::float8 AS "endedAtMs",
        gp."timeClass"::text AS "timeClass", gp.mode::text AS mode, gp.result::text AS result, gp."ratingBefore", gp.rated,
        gp.source::text AS source, gp."ecoCode", gp.accuracy, gp."phaseAccuracy", gp.stats, gp."errorThemes", gp."errorLog",
        gp."errorThemeN", gp."weaknessInputsV",
        CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END AS "oppTitle",
        ga."evalSource"::text AS "evalSource", (extract(epoch FROM ga."completedAt") * 1000)::float8 AS "analysedAtMs"
   FROM game_players gp
   JOIN games g ON g.id = gp."gameId"
   LEFT JOIN game_analyses ga ON ga."gameId" = gp."gameId"
  WHERE gp."userId" = $1::bigint AND gp."endedAt" >= ($2::timestamptz AT TIME ZONE 'UTC')
    AND gp."timeClass"::text = ANY($3::text[])
    AND gp.mode NOT IN ('BOT', 'LEGEND_BOT') AND gp.result IS DISTINCT FROM 'ABORTED'
    AND NOT (gp.source <> 'REPLAY' AND (CASE gp.color WHEN 'w' THEN g."blackTitle" ELSE g."whiteTitle" END) IS NOT DISTINCT FROM 'BOT')
  ORDER BY gp."endedAt" DESC, gp."gameId" DESC
  LIMIT ${INPUTS_LIMIT}`,
    [userId, since.toISOString(), [...timeClasses]],
  );
}

/** One Q-W5 row plus what the worker reads beside the engine's record. */
export interface LoadedInput extends WeaknessGameInput {
  /** game_analyses."completedAt" (epoch ms), null when not analysed. */
  analysedAtMs: number | null;
}

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function toLoadedInput(row: Row): LoadedInput {
  const color = row.color === "w" || row.color === "b" ? row.color : null;
  if (!color) throw new TypeError("game_players.color must be w or b");
  const endedAtMs = numOrNull(row.endedAtMs);
  const evalSource = str(row.evalSource);
  return {
    gameId: idStr(row.gameId),
    color,
    endedAt: endedAtMs === null ? null : new Date(endedAtMs),
    timeClass: (str(row.timeClass) as WeaknessGameInput["timeClass"]) ?? null,
    mode: String(row.mode) as WeaknessGameInput["mode"],
    result: (str(row.result) as WeaknessGameInput["result"]) ?? null,
    ratingBefore: numOrNull(row.ratingBefore),
    rated: row.rated === true,
    source: String(row.source) as WeaknessGameInput["source"],
    oppTitle: str(row.oppTitle),
    ecoCode: str(row.ecoCode),
    accuracy: numOrNull(row.accuracy),
    phaseAccuracy: numbers(row.phaseAccuracy),
    stats: numbers(row.stats),
    errorLog: numbers(row.errorLog),
    errorThemeN: numbers(row.errorThemeN),
    errorThemes: strings(row.errorThemes),
    weaknessInputsV: numOrNull(row.weaknessInputsV) ?? 0,
    evalSource: evalSource === "ENGINE" || evalSource === "LICHESS" || evalSource === "MIXED" ? evalSource : null,
    analysedAtMs: numOrNull(row.analysedAtMs),
  };
}

export async function loadWeaknessInputs(
  db: Db,
  userId: string,
  since: Date,
  timeClasses: readonly string[],
): Promise<LoadedInput[]> {
  const rows = await db.query(weaknessInputsStatement(userId, since, timeClasses));
  return rows.map(toLoadedInput);
}
