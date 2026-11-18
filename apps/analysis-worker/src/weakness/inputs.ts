// The five per-side weakness input columns (phase-06 plan §6.1, §8.3.2): `stats`, `errorThemes`, `errorLog`,
// `errorThemeN`, `weaknessInputsV`. They are computed by the ONE shared function (CA computeSideInputs, the same as
// the B-W1 backfill and the J5 baseline) and written in three places:
//   - P3's final analysis batch and the engine-free regrade (pipeline/final-batch/p06-weakness.ts), from the arrays
//     the batch itself writes;
//   - the recompute's heal of analysed rows still at `weaknessInputsV = 0` (§7.4.2 step 4), from the stored rows
//     (heal.ts reads them).
// The statement is set-based on the natural key (gameId, color) and idempotent; replay_worker may UPDATE exactly these
// five columns of game_players (replay_worker.p6.sql).
import type { Color } from "@repo/chess-analysis/codec";
import type { Replay } from "@repo/chess-analysis/replay";
import {
  computeSideInputs,
  WEAKNESS_INPUTS_VERSION,
  type SideInputs,
  type SideInputsAnalysis,
  type SideInputsGame,
} from "@repo/chess-analysis/weakness-inputs";
import { stmt, type Statement } from "../db/client";

export { WEAKNESS_INPUTS_VERSION };

/** One member side's computed columns. */
export interface SideInputsRow extends SideInputs {
  gameId: string;
  color: Color;
}

/**
 * Computes one side, or null when the stored rows are inconsistent (the error is reported by `onError`): a bad row
 * never fails an analysis or a recompute; it stays at `weaknessInputsV = 0` and is left out of the profile.
 */
export function sideInputsOf(
  gameId: string,
  game: SideInputsGame,
  analysis: SideInputsAnalysis,
  side: { color: Color; result: "WIN" | "LOSS" | "DRAW" | "ABORTED" | null },
  opts: {
    replay?: Replay;
    pass1Pv?: (ply: number) => readonly string[] | null | undefined;
    onError?: (error: unknown) => void;
    /** FIX-2: error plies tagged without a full line or refutation (computeSideInputs `report`). */
    report?: { partial: number };
  } = {},
): SideInputsRow | null {
  try {
    const out = computeSideInputs(game, analysis, side, {
      ...(opts.replay ? { replay: opts.replay } : {}),
      ...(opts.pass1Pv ? { pass1Pv: opts.pass1Pv } : {}),
      ...(opts.report ? { report: opts.report } : {}),
    });
    return { gameId, color: side.color, ...out };
  } catch (error) {
    opts.onError?.(error);
    return null;
  }
}

/**
 * The batch update of the five columns. `onlyMissing` (the heal): rows that already have inputs are left alone, so a
 * heal racing an analysis never overwrites the analysis's own values. RETURNING the updated count.
 */
export function sideInputsUpdateStatement(rows: readonly SideInputsRow[], opts: { onlyMissing?: boolean } = {}): Statement {
  return stmt(
    `WITH u AS (
  UPDATE game_players gp
     SET stats = v.st, "errorThemes" = v.et, "errorLog" = v.el, "errorThemeN" = v.etn, "weaknessInputsV" = $2::smallint
    FROM jsonb_to_recordset($1::jsonb) AS v("gameId" bigint, color text, st smallint[], et text[], el smallint[], etn smallint[])
   WHERE gp."gameId" = v."gameId" AND gp.color = v.color${opts.onlyMissing ? ` AND gp."weaknessInputsV" = 0` : ""}
  RETURNING 1
)
SELECT count(*)::int AS updated FROM u`,
    [
      JSON.stringify(
        rows.map((r) => ({ gameId: r.gameId, color: r.color, st: r.stats, et: r.errorThemes, el: r.errorLog, etn: r.errorThemeN })),
      ),
      WEAKNESS_INPUTS_VERSION,
    ],
  );
}
