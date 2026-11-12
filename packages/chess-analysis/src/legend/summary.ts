// What the screens say about a legend comparison (phase-03 plan §4.6, §4.7, §8.9), built from the facts row alone so
// the web DAL (LegendSummaryDTO, LegendCompareDTO) and the review builder agree.
//
//   summary rows   up to 6 rows of the member's moves, centred on the split: "12." · yours "Ba4" · the legend's
//                  "O-O-O" · mark (match before the split, split on the first member move at or after the
//                  divergence, none after it). With no divergence: the last 6 compared rows.
//   line rows      the Your Moves / legend's Moves tables, one row per move number (White, Black, mark).
//   outcomeLine    "Morphy won this; you drew." (the legend's result from the member's side).
//   summaryLine    "You matched 2 of 3 moves, then left Morphy’s path with 12.Ba4." / "You found every one of
//                  Morphy’s moves." / "You matched 3 of 3 moves before the game left Morphy’s path on 25…Qxe7."
//   matchedLine    the game-over block: "Matched 2 of 3 · left Morphy’s path with 12.Ba4" / "You followed Morphy to
//                  the end."
//   paragraph      the Explanation tab (§8.9): "You matched Morphy for 2 of 3 moves. On move 12 you played Ba4; Morphy
//                  played O-O-O.{ After that your winning chances were 41% against 78% for Morphy’s move.}"; the
//                  followed and opponent-left variants of §4.6.
//   replayHref     `/practice?game=<ref>&ply=<divergencePly>` (the position before the divergent move); null when the
//                  member followed the legend.
// The plan's board copy says "his path"; the templates name the legend instead ("Morphy’s path"), which needs no
// pronoun. Every SAN is replayed from the stored lines with chess.js.

import { moveLabel, moveNo, moverAt, type Color } from "../codec";
import { sideToMove } from "../board";
import { APOS, playLine } from "../text/facts";
import type { ComparisonFacts } from "./compare";
import type { MemberOutcome } from "./slice";

export const LEGEND_SUMMARY_MAX_ROWS = 6;
/** LegendCompareDTO `paragraph` ≤ 600, `summaryLine` ≤ 200, `outcomeLine` ≤ 120 characters. */
export const PARAGRAPH_MAX = 600;

export type RowMark = "match" | "split" | "none";

export interface SummaryRow {
  /** "12." / "12…" */
  n: string;
  yours: string;
  legend: string;
  mark: RowMark;
}

export interface LineRow {
  /** "12." */
  n: string;
  w: string | null;
  b: string | null;
  mark: RowMark;
}

export interface LegendContext {
  startFen: string;
  facts: ComparisonFacts;
}

function sansOf(startFen: string, line: string): string[] {
  return playLine(startFen, line === "" ? [] : line.split(" ")).map((m) => m.san);
}

/** The ply offset of the first member move at or after the divergence (null without one). */
function splitPly(c: LegendContext): number | null {
  const f = c.facts;
  if (f.divergencePly === null) return null;
  const startMover = sideToMove(c.startFen);
  return moverAt(f.divergencePly, startMover) === f.side ? f.divergencePly : f.divergencePly + 1;
}

function markOf(ply: number, split: number | null): RowMark {
  if (split === null || ply < split) return "match";
  return ply === split ? "split" : "none";
}

/** Up to 6 member-move rows centred on the split (the game-over table). */
export function summaryRows(c: LegendContext): SummaryRow[] {
  const f = c.facts;
  const startMover = sideToMove(c.startFen);
  const yours = sansOf(c.startFen, f.userLineUci);
  const legend = sansOf(c.startFen, f.legendLineUci);
  const split = splitPly(c);
  const last = split === null ? Math.min(yours.length, legend.length) - 1 : Math.max(yours.length, legend.length) - 1;
  const rows: { ply: number; row: SummaryRow }[] = [];
  for (let k = 0; k <= last; k++) {
    if (moverAt(k, startMover) !== f.side) continue;
    rows.push({
      ply: k,
      row: { n: moveLabel(k, f.startPly), yours: yours[k] ?? "", legend: legend[k] ?? "", mark: markOf(k, split) },
    });
  }
  const at = split === null ? rows.length - 1 : rows.findIndex((r) => r.ply === split);
  let from = Math.max(0, (at < 0 ? rows.length - 1 : at) - 3);
  const to = Math.min(rows.length, from + LEGEND_SUMMARY_MAX_ROWS);
  from = Math.max(0, to - LEGEND_SUMMARY_MAX_ROWS);
  return rows.slice(from, to).map((r) => r.row);
}

/**
 * One table row per move number for a stored line (`which` = the member's line or the legend's). The member's line
 * is marked match / split / none; the legend's rows are always `none` (they are the reference).
 */
export function lineRows(c: LegendContext, which: "yours" | "legend"): LineRow[] {
  const f = c.facts;
  const startMover = sideToMove(c.startFen);
  const sans = sansOf(c.startFen, which === "yours" ? f.userLineUci : f.legendLineUci);
  const split = splitPly(c);
  const rows: LineRow[] = [];
  const memberMarked = new Set<LineRow>();
  sans.forEach((san, k) => {
    const color: Color = moverAt(k, startMover);
    const n = `${moveNo(k, f.startPly)}.`;
    let row = rows[rows.length - 1];
    if (!row || row.n !== n) {
      row = { n, w: null, b: null, mark: "match" };
      rows.push(row);
    }
    row[color] = san;
    if (which === "legend") row.mark = "none";
    else if (color === f.side) {
      // The member's move decides the row's mark.
      row.mark = markOf(k, split);
      memberMarked.add(row);
    } else if (!memberMarked.has(row) && split !== null && k > split) row.mark = "none";
  });
  return rows;
}

const RESULT_VERB: Record<MemberOutcome, string> = { win: "won", loss: "lost", draw: "drew" };

/** "Morphy won this; you drew." The legend's result is read from the member's side. */
export function outcomeLine(f: ComparisonFacts, userResult: MemberOutcome | null): string {
  const legendOutcome: MemberOutcome =
    f.legendResult === "draw" ? "draw" : (f.legendResult === "white_won") === (f.side === "w") ? "win" : "loss";
  const head = `${f.historicalName} ${RESULT_VERB[legendOutcome]} this`;
  return userResult ? `${head}; you ${RESULT_VERB[userResult]}.` : `${head}.`;
}

function divergenceMove(f: ComparisonFacts, san: string | null): string {
  return f.divergencePly === null || san === null ? "" : `${moveLabel(f.divergencePly, f.startPly)}${san}`;
}

/** The aside's summary line on the compare page. */
export function summaryLine(f: ComparisonFacts): string {
  const name = f.historicalName;
  if (f.divergencePly === null) return `You found every one of ${name}${APOS}s moves.`;
  if (f.divergenceBy === "opponent") {
    return `You matched ${f.matchedPlies} of ${f.comparedPlies} moves before the game left ${name}${APOS}s path on ${divergenceMove(f, f.userSan)}.`;
  }
  return `You matched ${f.matchedPlies} of ${f.comparedPlies} moves, then left ${name}${APOS}s path with ${divergenceMove(f, f.userSan)}.`;
}

/** The game-over legend block's line. */
export function matchedLine(f: ComparisonFacts): string {
  const name = f.historicalName;
  if (f.divergencePly === null) return `You followed ${name} to the end.`;
  const verb = f.divergenceBy === "opponent" ? "the game left" : "left";
  return `Matched ${f.matchedPlies} of ${f.comparedPlies} · ${verb} ${name}${APOS}s path with ${divergenceMove(f, f.userSan)}`;
}

export interface ParagraphOptions {
  /** Who played the other side ("The engine", "Your opponent"). */
  opponentLabel?: string;
  /** The historical player on the other side ("Topalov"), for the opponent-left variant. */
  opponentHistoricalName?: string | null;
}

/** The Explanation tab's template paragraph (§8.9, with the §4.6 followed / opponent-left variants). */
export function comparisonParagraph(f: ComparisonFacts, opts: ParagraphOptions = {}): string {
  const name = f.historicalName;
  if (f.divergencePly === null) {
    return `You found every one of ${name}${APOS}s moves from move ${moveNo(0, f.startPly)}.`;
  }
  if (f.divergenceBy === "opponent") {
    const who = opts.opponentLabel ?? "The engine";
    const other = opts.opponentHistoricalName ?? "the original game";
    const verb = opts.opponentHistoricalName ? "played" : "continued";
    return (
      `${who} left the game${APOS}s path on ${divergenceMove(f, f.userSan)} (${other} ${verb} ` +
      `${divergenceMove(f, f.legendSan)}), so the comparison stops there.`
    );
  }
  const base =
    `You matched ${name} for ${f.matchedPlies} of ${f.comparedPlies} moves. On move ${moveNo(f.divergencePly, f.startPly)} ` +
    `you played ${f.userSan}; ${name} played ${f.legendSan}.`;
  const e = f.evalAtDivergence;
  if (!e) return base;
  return `${base} After that your winning chances were ${Math.round(e.userWin)}% against ${Math.round(e.legendWin)}% for ${name}${APOS}s move.`;
}

/** `/practice?game=<ref>&ply=<divergencePly>`; null when the member followed the legend. */
export function replayHref(ref: string, f: ComparisonFacts): string | null {
  return f.divergencePly === null ? null : `/practice?game=${encodeURIComponent(ref)}&ply=${f.divergencePly}`;
}

/** The divergence as the game-over block shows it, or null. */
export function divergenceSummary(
  f: ComparisonFacts,
): { ply: number; moveLabel: string; userSan: string; legendSan: string; by: "user" | "opponent" } | null {
  if (f.divergencePly === null || !f.userSan || !f.legendSan || !f.divergenceBy) return null;
  return {
    ply: f.divergencePly,
    moveLabel: moveLabel(f.divergencePly, f.startPly),
    userSan: f.userSan,
    legendSan: f.legendSan,
    by: f.divergenceBy,
  };
}

/** Everything of LegendSummaryDTO except `status` and `compareHref` (the DAL adds those). */
export function legendSummary(c: LegendContext, ref: string, userResult: MemberOutcome | null) {
  const f = c.facts;
  return {
    legendName: f.historicalName,
    legendResult: f.legendResult,
    matched: f.matchedPlies,
    compared: f.comparedPlies,
    divergence: divergenceSummary(f),
    rows: summaryRows(c),
    outcomeLine: outcomeLine(f, userResult),
    replayHref: replayHref(ref, f),
  };
}
