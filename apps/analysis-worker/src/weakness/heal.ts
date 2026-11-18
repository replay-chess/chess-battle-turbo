// RECOMPUTE_WEAKNESS step 4 (phase-06 plan §7.4.2): analysed rows still at `weaknessInputsV = 0` (analysed before the
// P6 worker, or a B-W1 backfill that has not reached them) get their five input columns here, so the profile never
// waits for a backfill. ONE read (the games and their analyses by primary key), the CPU-only computation (CA
// computeSideInputs with the P5 tagger) and ONE update (inputs.ts sideInputsUpdateStatement, `onlyMissing`).
//
// FIX-1 (review: the plan's "≈ 5 ms per row" was ~22 ms warm on an M-series Mac, a 179-row heal took 23 s):
//   - the tagger is ≈ 6× faster (CA see.ts generates only the attackers' moves; the fork and trapped-piece detectors
//     test their cheap conditions first; same tags, pinned by the J5 journal test on 50 real sides);
//   - one run heals at most WEAKNESS_HEAL_MAX_ROWS (HEAL_MAX_ROWS) rows, the newest first, and stops computing after
//     HEAL_BUDGET_MS of this machine's own time (so the slower 1-OCPU worker heals fewer rows per run, not slower
//     runs); when rows are left the handler commits these, re-queues itself after HEAL_CONTINUE_SEC and writes no
//     snapshot yet (a profile is never computed from half-healed inputs): a run stays inside §9.4's "heal ≤ 4 s";
//   - the update is its OWN statement before the final batch, never under the job row's lock: the analysis batch writes
//     game_players first and the weakness job row last, so the old order (job row, then game_players) could deadlock
//     with it (40P01). A healed row is correct whether or not the run later commits, and `onlyMissing` never
//     overwrites an analysis's own values.
import type { StoredLine } from "@repo/chess-analysis/analysis";
import type { Color } from "@repo/chess-analysis/codec";
import { weaknessLinesSql } from "@repo/db/weakness-jobs";
import { inputsFailedMarker, inputsHealable, inputsHealableSql } from "@repo/chess-analysis/weakness-inputs";
import { fromPrisma, idStr, num, numOrNull, stmt, type Db, type Row, type Statement } from "../db/client";
import { sideInputsOf, WEAKNESS_INPUTS_VERSION, type SideInputsRow } from "./inputs";
import type { LoadedInput } from "./load";

/**
 * The heal's one read (FIX-2, D-P6-FIX2-8): among `gameIds` (newest first), the games whose analysis is FINISHED, the
 * newest `limit` of them in that order, each with `total` = how many of `gameIds` are finished. A game whose analysis
 * is being redone (P3 clears `completedAt` when a re-analysis starts or fails) is skipped, not counted and not
 * retried here: its analysis writes the inputs itself. So unfinished rows can never fill the cap run after run.
 */
export function healReadStatement(gameIds: readonly string[], limit: number = HEAL_MAX_ROWS): Statement {
  return stmt(
    `WITH c AS (
  SELECT a."gameId", array_position($1::bigint[], a."gameId") AS pos
    FROM game_analyses a
   WHERE a."gameId" = ANY($1::bigint[]) AND a."completedAt" IS NOT NULL
), pick AS (
  SELECT "gameId", pos FROM c ORDER BY pos LIMIT $2
)
SELECT g.id::text AS "gameId", g."referenceId" AS ref, g."startingFen", g."startPly", g.moves, g."moveClocksMs", g."initialTimeSeconds",
        g."timeClass"::text AS "timeClass", a.evals, a.best, a.judgements, a.lines, a."middlegamePly", a."endgamePly",
        a."completedAt"::text AS "completedAtText", true AS done, (SELECT count(*) FROM c)::int AS total
   FROM pick JOIN games g ON g.id = pick."gameId" JOIN game_analyses a ON a."gameId" = g.id
  ORDER BY pick.pos`,
    [[...gameIds], Math.max(1, limit)],
  );
}

/**
 * `weaknessInputsV` of a row whose finished analysis could not be read into inputs (FIX-2): left out of the profile, as
 * at 0, but no longer a heal candidate under this version, so a heal never picks the same failing rows again. A later
 * analysis or regrade of the game writes real inputs over it; B-W1 selects 0 only. FIX-3 (D-P6-FIX3-8): the marker is
 * −WEAKNESS_INPUTS_VERSION, so a build with a fixed tagger (a higher version) retries the row once
 * (CA inputsHealable), and the daily heal sweep arms the members who have such rows.
 */
export const WEAKNESS_INPUTS_HEAL_FAILED = inputsFailedMarker();

/**
 * Marks rows the heal could not compute with `−version` (guarded by "still healable": an analysis that wrote real
 * inputs meanwhile wins).
 */
export function healFailedStatement(sides: readonly { gameId: string; color: string }[], version: number = WEAKNESS_INPUTS_VERSION): Statement {
  return stmt(
    `WITH u AS (
  UPDATE game_players gp SET "weaknessInputsV" = $2::smallint
    FROM jsonb_to_recordset($1::jsonb) AS v("gameId" bigint, color text)
   WHERE gp."gameId" = v."gameId" AND gp.color = v.color AND ${inputsHealableSql(`gp."weaknessInputsV"`, version)}
  RETURNING 1
)
SELECT count(*)::int AS marked FROM u`,
    [JSON.stringify(sides.map((x) => ({ gameId: x.gameId, color: x.color }))), inputsFailedMarker(version)],
  );
}

const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => num(x)) : []);

/** The rows a heal must compute: analysed, inputs missing (or failed under an earlier inputs version, FIX-3). */
export function rowsToHeal(inputs: readonly LoadedInput[], version: number = WEAKNESS_INPUTS_VERSION): LoadedInput[] {
  return inputs.filter((g) => g.accuracy !== null && inputsHealable(g.weaknessInputsV, version));
}

/** Rows one run heals by default (WEAKNESS_HEAL_MAX_ROWS). */
export const HEAL_MAX_ROWS = 40;
/**
 * A run stops computing heal rows after this long (measured on the machine: ≈ 50 rows on a laptop core, ≈ 20 on the
 * OCI A1). With ~7 round trips at Mumbai → us-east-1 (≈ 1.4 s) a heal run stays under 4 s.
 */
export const HEAL_BUDGET_MS = 1_500;
/** A run that left rows unhealed runs again after this long (other I/O jobs claim in between). */
export const HEAL_CONTINUE_SEC = 2;

export interface HealPlan {
  rows: SideInputsRow[];
  /** Rows whose stored game or analysis could not be read into inputs (marked −1 by the caller, out of the profile). */
  failed: number;
  /** Those rows (FIX-2: `healFailedStatement` marks them so the next run never picks them again). */
  failedSides: { gameId: string; color: string }[];
  /** Finished rows still at weaknessInputsV = 0 beyond this run's cap or budget (the next run heals them). */
  remaining: number;
  /**
   * FIX-2 (D-P6-FIX2-8): games whose healed side was tagged without a full line for some error (stored data has the
   * best move only, where J5 tagged the band from a full PV). The caller arms a `weakness_lines` refresh for each, which
   * writes fully tagged inputs over the healed ones (`linesRegradeStatements`).
   */
  partialGames: { gameId: string; ref: string }[];
}

/** Computes the heal rows from the stored games and analyses (`stored` = healReadStatement's rows). */
export function healRows(toHeal: readonly LoadedInput[], stored: readonly Row[], onError?: (error: unknown) => void): Omit<HealPlan, "remaining"> {
  const byId = new Map(stored.map((r) => [idStr(r.gameId), r]));
  const rows: SideInputsRow[] = [];
  const failedSides: HealPlan["failedSides"] = [];
  const partialGames: HealPlan["partialGames"] = [];
  for (const g of toHeal) {
    const r = byId.get(g.gameId);
    if (!r || r.done !== true) {
      failedSides.push({ gameId: g.gameId, color: g.color });
      continue;
    }
    const report = { partial: 0 };
    const out = sideInputsOf(
      g.gameId,
      {
        startingFen: String(r.startingFen),
        startPly: num(r.startPly ?? 0),
        moves: typeof r.moves === "string" ? r.moves : "",
        moveClocksMs: numbers(r.moveClocksMs),
        initialTimeSeconds: numOrNull(r.initialTimeSeconds),
        timeClass: typeof r.timeClass === "string" ? r.timeClass : null,
      },
      {
        evals: numbers(r.evals),
        best: numbers(r.best),
        judgements: numbers(r.judgements),
        lines: r.lines && typeof r.lines === "object" ? (r.lines as Record<string, StoredLine>) : null,
        middlegamePly: numOrNull(r.middlegamePly),
        endgamePly: numOrNull(r.endgamePly),
      },
      { color: g.color as Color, result: g.result },
      { onError, report },
    );
    if (out) {
      rows.push(out);
      if (report.partial > 0 && typeof r.ref === "string") partialGames.push({ gameId: g.gameId, ref: r.ref });
    } else failedSides.push({ gameId: g.gameId, color: g.color });
  }
  return { rows, failed: failedSides.length, failedSides, partialGames };
}

/** Applies a heal's rows to the in-memory inputs (the profile is computed from the healed values in the same run). */
export function applyHeal(inputs: LoadedInput[], rows: readonly SideInputsRow[], version: number = WEAKNESS_INPUTS_VERSION): void {
  const key = (id: string, c: string) => `${id}:${c}`;
  const healed = new Map(rows.map((r) => [key(r.gameId, r.color), r]));
  for (const g of inputs) {
    const h = healed.get(key(g.gameId, g.color));
    if (!h) continue;
    g.stats = h.stats;
    g.errorLog = h.errorLog;
    g.errorThemeN = h.errorThemeN;
    g.errorThemes = h.errorThemes;
    g.weaknessInputsV = version;
  }
}

/** Rows computed between two yields to the event loop (and budget checks; the tagger costs ≈ 5–50 ms per side). */
export const HEAL_CHUNK = 4;

/**
 * Reads and computes the heal of `inputs` (one round trip when anything needs healing, none otherwise). The CPU work
 * yields to the event loop every HEAL_CHUNK rows, so a long heal never starves the heartbeat, the other I/O slot or
 * the engine lane of this process.
 */
export async function planHeal(
  db: Db,
  inputs: readonly LoadedInput[],
  onError?: (error: unknown) => void,
  maxRows: number = HEAL_MAX_ROWS,
  budgetMs: number = HEAL_BUDGET_MS,
  version: number = WEAKNESS_INPUTS_VERSION,
): Promise<HealPlan> {
  const all = rowsToHeal(inputs, version);
  if (all.length === 0) return { rows: [], failed: 0, failedSides: [], remaining: 0, partialGames: [] };
  const cap = Math.max(1, maxRows);
  // FIX-2: the read picks the newest finished analyses itself, so rows whose analysis is being redone never occupy
  // the cap, and rows that failed before (−1) are no candidates at all: every run makes progress or ends the heal.
  const stored = await db.query(healReadStatement([...new Set(all.map((g) => g.gameId))], cap));
  const finished = new Set(stored.map((r) => idStr(r.gameId)));
  const total = num(stored[0]?.total ?? 0);
  const toHeal = all.filter((g) => finished.has(g.gameId)).slice(0, cap);
  const out: HealPlan = { rows: [], failed: 0, failedSides: [], remaining: 0, partialGames: [] };
  // The machine's own elapsed time (never the job clock: a FakeClock in tests does not move while CPU work runs).
  const t0 = performance.now();
  let done = 0;
  while (done < toHeal.length) {
    const part = healRows(toHeal.slice(done, done + HEAL_CHUNK), stored, onError);
    done = Math.min(toHeal.length, done + HEAL_CHUNK);
    out.rows.push(...part.rows);
    out.failed += part.failed;
    out.failedSides.push(...part.failedSides);
    out.partialGames.push(...part.partialGames);
    if (done < toHeal.length) {
      if (performance.now() - t0 >= budgetMs) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  // Finished rows left for the next run: those past this run's cap or budget (a member side is one per game).
  out.remaining = Math.max(0, total - done);
  return out;
}

/**
 * FIX-2 (D-P6-FIX2-8): one `weakness_lines` ANALYZE_GAME row per game (@repo/db weaknessLinesSql: its own dedupe key,
 * HOUSEKEEPING, no userId). The engine lane searches every member error's line and refutation of the finished analysis
 * and rewrites the five input columns over the healed ones (pipeline/analyze-game.ts `linesRefresh`); the game's
 * analysis status, review and analysis job are never touched.
 */
export function linesRegradeStatements(games: readonly { gameId: string; ref: string }[]): Statement[] {
  return games.length === 0 ? [] : [fromPrisma(weaknessLinesSql(games.map((g) => ({ gameId: g.gameId, gameRef: g.ref }))))];
}
