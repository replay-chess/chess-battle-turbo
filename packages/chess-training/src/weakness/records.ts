// The per-game input records (phase-06 plan §6.4): STATS_V1 and ERROR_LOG_V1 are owned by CA/src/codec.ts (WP3, the
// worker writes them); the engine reads them through this one module, so a codec change touches one import list.
// Decoding is strict: a corrupt stored array throws instead of being averaged in silently.
import { CLOCK_BUCKET } from "@repo/chess-analysis/clock";
import {
  decodeErrorLog,
  decodeStatsV1,
  ERROR_LOG_J,
  ERROR_THEMES_MAX,
  type ErrorLogEntry,
  STATS_V1,
  STATS_V1_LENGTH,
  type StatsV1,
} from "@repo/chess-analysis/codec";
import type { WeaknessGameInput } from "./types";

export { decodeErrorLog, decodeStatsV1, STATS_V1, STATS_V1_LENGTH, type ErrorLogEntry, type StatsV1 };

/** ERROR_LOG_V1 judgement values (the codec's `ERROR_LOG_J`). */
export const J_MISTAKE = ERROR_LOG_J.MISTAKE;
export const J_BLUNDER = ERROR_LOG_J.BLUNDER;
export const J_MISS = ERROR_LOG_J.MISS;
/** ERROR_LOG_V1 clock values (the codec's `CLOCK_BUCKET`; 0 = unknown). */
export const CLOCK_UNKNOWN = CLOCK_BUCKET.UNKNOWN;
export const CLOCK_LT1 = CLOCK_BUCKET.LT1;
/** ERROR_LOG_V1 clock value → the STATS_V1 bucket index 0..3 (gt5, 2to5, 1to2, lt1), or null for unknown. */
export function clockIndex(bucket: number): 0 | 1 | 2 | 3 | null {
  return bucket >= CLOCK_BUCKET.GT5 && bucket <= CLOCK_BUCKET.LT1 ? ((bucket - CLOCK_BUCKET.GT5) as 0 | 1 | 2 | 3) : null;
}

/** One decoded error of a game side with the themes it carries (no meta tags, never `rc:timePressure`). */
export interface DecodedError extends ErrorLogEntry {
  themes: readonly string[];
}

/** A game side's decoded inputs. */
export interface DecodedGame {
  stats: StatsV1;
  errors: DecodedError[];
}

/**
 * Decodes one analysed row. Null when its inputs are not computed (`weaknessInputsV = 0`, or a STATS_V1 array of
 * another length): the caller heals such rows before computing, and the engine leaves any it still gets out.
 * Throws when the arrays disagree (Σ errorThemeN ≠ errorThemes.length, or errorThemeN.length ≠ errorLog.length).
 */
export function decodeGame(g: Pick<WeaknessGameInput, "stats" | "errorLog" | "errorThemeN" | "errorThemes" | "weaknessInputsV" | "gameId">): DecodedGame | null {
  if (g.weaknessInputsV < 1) return null;
  const stats = decodeStatsV1(g.stats);
  if (!stats) return null;
  if (g.errorThemeN.length !== g.errorLog.length) {
    throw new RangeError(`game ${g.gameId}: ${g.errorThemeN.length} errorThemeN entries for ${g.errorLog.length} errors`);
  }
  const errors: DecodedError[] = [];
  let off = 0;
  for (let i = 0; i < g.errorLog.length; i++) {
    const n = g.errorThemeN[i]!;
    if (!Number.isInteger(n) || n < 0 || n > ERROR_THEMES_MAX) throw new RangeError(`game ${g.gameId}: errorThemeN[${i}] = ${n}`);
    errors.push({ ...decodeErrorLog(g.errorLog[i]!), themes: g.errorThemes.slice(off, off + n) });
    off += n;
  }
  if (off !== g.errorThemes.length) throw new RangeError(`game ${g.gameId}: Σ errorThemeN = ${off} ≠ ${g.errorThemes.length} themes`);
  return { stats, errors };
}
