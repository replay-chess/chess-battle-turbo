// Legend comparison in the worker (phase-03 plan §8.9, §8.12 steps 2 and 7, P3-D24).
//
// Facts: every writer (bot `complete`, the web's A2/A9 lazy insert, the DB backfill, this worker) computes them with
// the one pure rule in @repo/chess-analysis/legend/facts (`legendFactsOf`: the member side's linked legend record
// name, else the position's player name; the surname; the skip reasons) and inserts with ON CONFLICT DO NOTHING, so
// whoever writes first wins and the others agree. The load statement reads the linked `legends` names (replay_worker
// has SELECT (id, name) on legends for exactly this).
//
// Evals at the divergence: Win% for the member after the game's move and after the legend's move at the divergence
// ply, both searched at the pass-2 budget (1 decimal). ANALYZE_GAME computes them inside its pass-2 budget (2
// positions); LEGEND_COMPARE (A9b) computes them on demand.
import { legendFactsOf } from "@repo/chess-analysis/legend/facts";
import { encodeMate, evalFor, type Color } from "@repo/chess-analysis/codec";
import { epdOf } from "@repo/chess-analysis/board";
import { winPct } from "@repo/chess-analysis/winpct";
import { buildComparisonFacts, parseComparisonFacts, type ComparisonFactsV1 } from "@repo/db/json";
import { Chess } from "chess.js";
import type { PositionPlan } from "./positions";
import type { LegendSource, StoredComparison } from "./types";

/** The facts of one member of a legend game, or null when there is nothing to compare. */
export function legendFactsFor(input: {
  legend: LegendSource;
  startFen: string;
  startPly: number;
  moves: readonly string[];
  member: Color;
}): ComparisonFactsV1 | null {
  const { legend } = input;
  const out = legendFactsOf({
    names: legend,
    pgn: legend.pgn,
    gameMetadata: legend.gameMetadata,
    moveNumber: legend.moveNumber,
    startFen: input.startFen,
    startPly: input.startPly,
    moves: input.moves,
    member: input.member,
  });
  return out.ok ? buildComparisonFacts(out.facts) : null;
}

export interface MemberFacts {
  userId: string;
  color: Color;
  facts: ComparisonFactsV1;
  /** The row exists (from any writer); otherwise this run inserts it. */
  stored: boolean;
  status: StoredComparison["status"] | null;
}

/** The facts per member: the stored row when there is one, else computed now (inserted by the first write). */
export function memberFacts(input: {
  legend: LegendSource | null;
  comparisons: readonly StoredComparison[];
  members: readonly { userId: string; color: Color }[];
  startFen: string;
  startPly: number;
  moves: readonly string[];
}): MemberFacts[] {
  if (!input.legend) return [];
  const out: MemberFacts[] = [];
  for (const m of input.members) {
    const row = input.comparisons.find((c) => c.userId === m.userId);
    const parsed = row ? parseComparisonFacts(row.facts) : null;
    if (row && parsed) {
      out.push({ userId: m.userId, color: m.color, facts: parsed, stored: true, status: row.status });
      continue;
    }
    if (row) continue; // a row another writer owns but that does not parse: leave it alone
    const facts = legendFactsFor({
      legend: input.legend,
      startFen: input.startFen,
      startPly: input.startPly,
      moves: input.moves,
      member: m.color,
    });
    if (facts) out.push({ userId: m.userId, color: m.color, facts, stored: false, status: null });
  }
  return out;
}

/** The divergence the members share (every member's facts walk the same two lines), or null. */
export function divergenceOf(
  facts: readonly MemberFacts[],
): { ply: number; gameUci: string; legendUci: string } | null {
  for (const f of facts) {
    const d = f.facts;
    if (d.divergencePly !== null && d.userUci && d.legendUci)
      return { ply: d.divergencePly, gameUci: d.userUci, legendUci: d.legendUci };
  }
  return null;
}

/**
 * The position after the legend's move at the divergence ply, planned like a game position (the history since the
 * last irreversible move, so the engine sees repetitions). Null when the legend move is not legal there.
 */
export function legendPosition(
  base: PositionPlan,
  legendUci: string,
  gameEpds: readonly string[],
): PositionPlan | null {
  const chess = new Chess(base.fen);
  try {
    chess.move({ from: legendUci.slice(0, 2), to: legendUci.slice(2, 4), promotion: legendUci[4] });
  } catch {
    return null;
  }
  const fen = chess.fen();
  const epd = epdOf(fen);
  const halfmoveClock = Number(fen.split(" ")[4] ?? "0");
  const mover: Color = base.mover === "w" ? "b" : "w";
  let terminal: number | null = null;
  if (chess.isCheckmate()) terminal = encodeMate(base.mover, 0);
  else if (chess.isDraw() || chess.isStalemate()) terminal = 0;
  const irreversible = halfmoveClock === 0;
  return {
    index: base.index + 1,
    fen,
    epd,
    mover,
    terminal,
    searchFen: irreversible ? fen : base.searchFen,
    searchMoves: irreversible ? [] : [...base.searchMoves, legendUci],
    halfmoveClock,
    seenEarlier: gameEpds.slice(0, base.index + 1).includes(epd),
  };
}

/** Win% for `member` of two stored evals (White POV), 1 decimal. */
export function evalAtDivergence(
  member: Color,
  gameEval: number,
  legendEval: number,
): { userWin: number; legendWin: number } {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { userWin: r1(winPct(evalFor(gameEval, member))), legendWin: r1(winPct(evalFor(legendEval, member))) };
}
