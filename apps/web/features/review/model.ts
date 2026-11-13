// Pure derivations of the review payload (phase-03 plan §4.1, §5.2, §8.1, §8.4): the plies replayed once on the
// client (FENs are not sent, §9.6), per-ply judgements, evals and Win%, the progress and failure lines, the label
// counts, the eval graph and the move rows. No React and no zod: the review chunk keeps zod out of production (AP-12),
// so contract types are imported as types only and the codec comes from @repo/chess-analysis.
//
// Index base (§8.1): ply i (0-based offset from `game.startPly`) moves from position i to position i + 1; position 0
// is `game.startFen`. The view's `ply` is the ply whose result is on the board; −1 is the start position.

import { Chess, type Square } from "chess.js";
import type { ReviewAnalysis, ReviewDTO } from "@repo/contracts/http/review";
import {
  evalFor,
  judgementFromChar,
  judgementKey,
  JUDGEMENT_KEYS,
  mateMoves,
  moveLabel,
  type Color,
  type JudgementCode,
  type JudgementKey,
} from "@repo/chess-analysis/codec";
import { plyReason } from "@repo/chess-analysis/text/reasons";
import { winPct } from "@repo/chess-analysis/winpct";
import { COPY } from "./copy";
import { movesProgress } from "./progress";

export type Side = Color;
export type { JudgementKey };

export const other = (s: Side): Side => (s === "w" ? "b" : "w");

// ── Replay ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Plies {
  startFen: string;
  startPly: number;
  /** Side to move in position 0. */
  startMover: Side;
  uci: string[];
  san: string[];
  /** Positions 0 … n (n = plies). */
  fens: string[];
  /** The from/to squares of each ply. */
  moves: { from: Square; to: Square }[];
  /** The king in check in each position (0 … n), or null. */
  checks: (Square | null)[];
}

let replayMemo: { key: string; plies: Plies } | null = null;

/**
 * Replays the game once (one-entry memo: the list, the strip, the graph and the board share it). A move that does not
 * replay (a corrupt payload) ends the replay there; everything before it still renders.
 */
export function pliesOf(startFen: string, startPly: number, moves: string): Plies {
  const key = `${startFen}|${moves}`;
  if (replayMemo?.key === key) return replayMemo.plies;
  const chess = new Chess(startFen);
  const kingInCheck = (): Square | null => {
    if (!chess.inCheck()) return null;
    return chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null;
  };
  const plies: Plies = {
    startFen,
    startPly,
    startMover: chess.turn(),
    uci: [],
    san: [],
    fens: [chess.fen()],
    moves: [],
    checks: [kingInCheck()],
  };
  const list = moves.trim() === "" ? [] : moves.trim().split(/\s+/);
  for (const uci of list) {
    let mv;
    try {
      mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    } catch {
      break;
    }
    plies.uci.push(uci);
    plies.san.push(mv.san);
    plies.fens.push(mv.after);
    plies.moves.push({ from: mv.from, to: mv.to });
    plies.checks.push(kingInCheck());
  }
  replayMemo = { key, plies };
  return plies;
}

/** The plies of a review payload. */
export function reviewPlies(dto: Pick<ReviewDTO, "game" | "moves">): Plies {
  return pliesOf(dto.game.startFen, dto.game.startPly, dto.moves);
}

/** Who moved ply `i`. */
export function moverOf(plies: Pick<Plies, "startMover">, i: number): Side {
  return (i % 2 === 0) === (plies.startMover === "w") ? "w" : "b";
}

/** "19.Qd2", "19…Bg3". */
export function moveText(plies: Plies, i: number): string {
  return `${moveLabel(i, plies.startPly)}${plies.san[i] ?? ""}`;
}

/** Full-move number of ply `i` (§8.1). */
export function moveNumber(startPly: number, i: number): number {
  return Math.floor((startPly + i) / 2) + 1;
}

// ── Grades and evals ────────────────────────────────────────────────────────────────────────────────────────────

type Graded = Pick<ReviewAnalysis, "gradedPlies" | "j" | "evals" | "best">;

/** The judgement of ply `i`, or null while it is not graded. */
export function judgementAt(a: Graded | null, i: number): JudgementKey | null {
  if (!a || i < 0 || i >= a.gradedPlies || i >= a.j.length) return null;
  try {
    return judgementKey(judgementFromChar(a.j.charAt(i)));
  } catch {
    return null;
  }
}

/** The stored eval (White POV) of position `k`, or null when it is not known yet. */
export function evalAt(a: Graded | null, k: number): number | null {
  if (!a || k < 0 || k > a.gradedPlies || k >= a.evals.length) return null;
  return a.evals[k] ?? null;
}

/** The engine's best move (UCI) before ply `i`, or null when unknown. */
export function bestUciAt(a: Graded | null, i: number): string | null {
  if (!a || i < 0 || i >= a.gradedPlies) return null;
  const tok = a.best === "" ? undefined : a.best.split(" ")[i];
  return tok && tok !== "-" ? tok : null;
}

/** "White is winning" … "About level" (V3ReviewSummary evalWords); a finished mate reads "Checkmate". */
export function evalWords(e: number | null): string {
  if (e === null) return "";
  if (mateMoves(e) === 0) return "Checkmate";
  if (e > 250) return "White is winning";
  if (e > 80) return "White is better";
  if (e < -250) return "Black is winning";
  if (e < -80) return "Black is better";
  return "About level";
}

/** A score from `viewer`'s side with a sign (DS "Scores"): "+0.4", "−1.3", "M3", "−M3". */
export function scoreText(e: number, viewer: Side): string {
  const mine = evalFor(e, viewer);
  const n = mateMoves(mine);
  if (n !== null) return `${mine > 0 ? "" : "−"}M${n}`;
  const pawns = Math.abs(mine) / 100;
  return `${mine >= 0 ? "+" : "−"}${pawns.toFixed(1)}`;
}

/** White's share of the eval bar, 0–100 (Win%, so mates and big advantages saturate near the ends). */
export function whiteShare(e: number | null): number {
  return e === null ? 50 : Math.round(winPct(e) * 10) / 10;
}

/** The one-line reason the Moves tab shows for ply `i` (§8.4 reason templates, CA text/reasons). */
export function reasonAt(plies: Plies, a: (Graded & { gradedPlies: number }) | null, i: number): string {
  const j = judgementAt(a, i);
  const evalBefore = evalAt(a, i);
  const fenBefore = plies.fens[i];
  if (!j || evalBefore === null || !fenBefore) return "Still analysing this move.";
  const mover = moverOf(plies, i);
  try {
    return plyReason({
      code: (JUDGEMENT_KEYS.indexOf(j) + 1) as JudgementCode,
      fenBefore,
      bestUci: bestUciAt(a, i),
      evalBefore,
      mover,
      winBefore: winPct(evalFor(evalBefore, mover)),
    });
  } catch {
    return "";
  }
}

// ── Status, progress and failure ────────────────────────────────────────────────────────────────────────────────

export type ReviewPhase =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "queued"; etaSec: number | null; position: number | null }
  | { kind: "running" }
  /** `step`: pass 2's `at` of `of` deep searches (`analysis:writing` counts), null until the first counted frame. */
  | { kind: "writing"; step: WritingStep | null }
  | { kind: "failed"; retryable: boolean; retryAt: string | null; failedAtPly: number }
  | { kind: "skipped" }
  | { kind: "done"; clean: boolean; moments: number };

export type WritingStep = { at: number; of: number };

/** The screen's state from the payload (`writing` is the client's `analysis:writing` flag, `step` its last counts). */
export function phaseOf(
  dto: Pick<ReviewDTO, "status" | "analysis" | "review">,
  writing: boolean,
  step: WritingStep | null = null,
): ReviewPhase {
  const a = dto.analysis;
  switch (dto.status) {
    case "none":
      return { kind: "none" };
    case "queued":
      return { kind: "queued", etaSec: a?.queue?.etaSec ?? null, position: a?.queue?.position ?? null };
    case "running":
      return writing ? { kind: "writing", step } : { kind: "running" };
    case "failed":
      return {
        kind: "failed",
        retryable: a?.failure?.retryable ?? true,
        retryAt: a?.failure?.retryAt ?? null,
        failedAtPly: a?.failure?.failedAtPly ?? a?.gradedPlies ?? 0,
      };
    case "skipped":
      return { kind: "skipped" };
    case "done":
      return dto.review
        ? { kind: "done", clean: dto.review.isClean, moments: dto.review.moments.length }
        : // A done payload without the viewer's content (a race with the final batch): show the grades, no moments.
          { kind: "done", clean: false, moments: 0 };
  }
}

export interface Progress {
  /** 0–100. */
  pct: number;
  movesDone: number;
  movesTotal: number;
}

/**
 * "move 23 of 61 · 38%": full moves are `ceil(plies / 2)` (plan §4.1 copy notes). Writing (pass 2) starts at 95 % and
 * moves with its `at` of `of` deep searches up to 99 % (dev pass D3: it sat at 95 % for the phase's ~10 s).
 */
export function progressOf(
  a: Pick<ReviewAnalysis, "gradedPlies" | "totalPlies"> | null,
  writing: boolean,
  step: WritingStep | null = null,
): Progress {
  const graded = a?.gradedPlies ?? 0;
  const total = a?.totalPlies ?? 0;
  const { movesDone, movesTotal } = movesProgress(graded, total);
  const pct = writing
    ? 95 + (step && step.of > 0 ? Math.floor((4 * Math.min(step.at, step.of)) / step.of) : 0)
    : total > 0 ? Math.min(100, Math.round((graded / total) * 100)) : 0;
  return { pct, movesDone, movesTotal };
}

/**
 * "The engine stopped at move 16 of 27. Moves 1 to 15 are graded below." (this fixes the plies/moves mix-up,
 * rct-a §4.2): the moves before the one the engine stopped on are the fully graded ones.
 */
export function failureLine(startPly: number, totalPlies: number, failedAtPly: number): string {
  const total = Math.max(1, totalPlies);
  const at = Math.min(Math.max(0, failedAtPly), total - 1);
  const stopped = moveNumber(startPly, at);
  const last = moveNumber(startPly, total - 1);
  const first = moveNumber(startPly, 0);
  const lead = `The engine stopped at move ${stopped} of ${last}.`;
  const done = stopped - 1;
  if (done < first) return `${lead} No move was graded before it stopped.`;
  if (done === first) return `${lead} Move ${first} is graded below.`;
  return `${lead} Moves ${first} to ${done} are graded below.`;
}

/** Whole seconds until `retryAt` (never negative). */
export function secondsUntil(retryAt: string | null, now: number): number | null {
  if (!retryAt) return null;
  const at = Date.parse(retryAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

// ── Players and the result ──────────────────────────────────────────────────────────────────────────────────────

/** True when the viewer lost (a clean loss gets no congratulation, plan §4.1). */
export function viewerLost(dto: Pick<ReviewDTO, "you" | "game">): boolean {
  return (dto.game.result === "1-0" && dto.you === "b") || (dto.game.result === "0-1" && dto.you === "w");
}

// ── Label counts (V3ReviewSummary counts table) ─────────────────────────────────────────────────────────────────

/** The ten rows the table always shows; Forced and Interesting join (in code order) when either side has one. */
const ALWAYS: ReadonlySet<JudgementKey> = new Set<JudgementKey>([
  "brilliant",
  "great",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
]);

export interface CountRow {
  key: JudgementKey;
  you: number;
  opp: number;
}

export function countRows(counts: { w: readonly number[]; b: readonly number[] }, you: Side): CountRow[] {
  const mine = counts[you];
  const theirs = counts[other(you)];
  const rows: CountRow[] = [];
  JUDGEMENT_KEYS.forEach((key, idx) => {
    const code = idx + 1;
    const row = { key, you: mine[code] ?? 0, opp: theirs[code] ?? 0 };
    if (ALWAYS.has(key) || row.you > 0 || row.opp > 0) rows.push(row);
  });
  return rows;
}

// ── Eval graph (540 × 72 viewBox; the viewer's side up, P3-Q8) ──────────────────────────────────────────────────

export const GRAPH_W = 540;
export const GRAPH_H = 72;
/** At most this many points are drawn; longer games are downsampled (plan §4.1 EvalGraph). */
export const GRAPH_MAX_POINTS = 240;

/** The judgements that get a tick on the graph (the viewer's own moves only). */
export const TICK_KEYS: ReadonlySet<JudgementKey> = new Set<JudgementKey>([
  "brilliant",
  "inaccuracy",
  "mistake",
  "miss",
  "blunder",
]);

export interface Graph {
  /** `points` of the polyline. */
  line: string;
  /** `points` of the filled area under the line. */
  area: string;
  ticks: { x: number; ply: number; key: JudgementKey }[];
}

/** x of position `k` (0 … total) on the 540-wide graph. */
export function graphX(k: number, totalPlies: number): number {
  return totalPlies > 0 ? (Math.min(Math.max(k, 0), totalPlies) / totalPlies) * GRAPH_W : 0;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function graphOf(a: Graded & { totalPlies: number }, plies: Plies, viewer: Side): Graph {
  const total = a.totalPlies;
  const known = Math.min(a.gradedPlies + 1, a.evals.length);
  const pts: [number, number][] = [];
  const step = Math.max(1, Math.ceil(known / GRAPH_MAX_POINTS));
  for (let k = 0; k < known; k += step) pts.push([graphX(k, total), GRAPH_H - (winPct(evalFor(a.evals[k] ?? 0, viewer)) / 100) * GRAPH_H]);
  if (known > 0 && (known - 1) % step !== 0) {
    const k = known - 1;
    pts.push([graphX(k, total), GRAPH_H - (winPct(evalFor(a.evals[k] ?? 0, viewer)) / 100) * GRAPH_H]);
  }
  const line = pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
  const lastX = pts.length ? pts[pts.length - 1]![0] : 0;
  const area = pts.length ? `0,${GRAPH_H} ${line} ${fmt(lastX)},${GRAPH_H}` : "";
  const ticks: Graph["ticks"] = [];
  for (let i = 0; i < a.gradedPlies; i++) {
    if (moverOf(plies, i) !== viewer) continue;
    const key = judgementAt(a, i);
    if (key && TICK_KEYS.has(key)) ticks.push({ x: graphX(i + 1, total), ply: i, key });
  }
  return { line, area, ticks };
}

// ── Move list rows and the phone strip ──────────────────────────────────────────────────────────────────────────

export interface MoveCell {
  ply: number;
  san: string;
  /** "19.Qd2". */
  text: string;
  key: JudgementKey | null;
}

export interface MoveRow {
  no: number;
  w: MoveCell | null;
  b: MoveCell | null;
}

export function moveRows(plies: Plies, a: Graded | null): MoveRow[] {
  const rows: MoveRow[] = [];
  plies.san.forEach((san, ply) => {
    const no = moveNumber(plies.startPly, ply);
    const cell: MoveCell = { ply, san, text: moveText(plies, ply), key: judgementAt(a, ply) };
    const white = moverOf(plies, ply) === "w";
    let row = rows[rows.length - 1];
    if (!row || row.no !== no || (white && row.w) || (!white && row.b)) {
      row = { no, w: null, b: null };
      rows.push(row);
    }
    if (white) row.w = cell;
    else row.b = cell;
  });
  return rows;
}

/** The phone strip: up to 7 plies around the current one (3 before, 3 after). */
export function stripCells(plies: Plies, a: Graded | null, ply: number, size = 7): MoveCell[] {
  const n = plies.san.length;
  if (n === 0) return [];
  const half = Math.floor(size / 2);
  const center = Math.min(Math.max(ply, 0), n - 1);
  let start = Math.max(0, center - half);
  const end = Math.min(n, start + size);
  start = Math.max(0, end - size);
  const out: MoveCell[] = [];
  for (let i = start; i < end; i++) out.push({ ply: i, san: plies.san[i]!, text: moveText(plies, i), key: judgementAt(a, i) });
  return out;
}

/** "After 19.Qd2" for the position label; "Start position" before the first ply. */
export function positionLabel(plies: Plies, ply: number): string {
  return ply < 0 ? COPY.startPosition : `After ${moveText(plies, ply)}`;
}

/** Clamps a requested ply into the replayed range (−1 … n − 1). */
export function clampPly(plies: Plies, ply: number): number {
  const n = plies.san.length;
  if (!Number.isFinite(ply)) return n - 1;
  return Math.min(Math.max(Math.trunc(ply), -1), n - 1);
}
