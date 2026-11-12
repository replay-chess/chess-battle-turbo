// Compare with the legend: the screen's pure model (phase-03 plan §4.6, §5.7, §8.9; boards V3LegendCompare and the
// merged V3TryCompare stepper). No React, no zod: the client chunk replays the two lines once with chess.js and
// everything else is derived from the A9 payload (LegendCompareDTO) and the view {tab, line, pos}.
//
// Positions are indexes into a line: 0 = the start position (`startFen`, the legend position's start), i = after the
// line's i-th ply. Ply numbers in the DTO (`divergence.ply`, `practice.ply`) are offsets from `startPly` (§8.1), so
// the position before the divergent move is index `divergence.ply`; both lines are identical up to it, and that is
// where the board shows the two arrows (yours grey, the legend's sky, never colour alone: the label names both).
import { Chess, type Square } from "chess.js";
import type { LegendCompareDTO, LegendLineRow } from "@repo/contracts/http/legend";
import { LEGEND_COMPUTE_MAX_ATTEMPTS } from "@repo/contracts/http/plain";

export type CompareTab = "explanation" | "your_moves" | "legend_moves" | "practice";
export const COMPARE_TABS: readonly CompareTab[] = ["explanation", "your_moves", "legend_moves", "practice"];
export type LineKey = "yours" | "legend";
export type Side = "w" | "b";

/** The two arrows at the split (V3LegendCompare divMarks): yours grey, the legend's sky (`--cb-sky-500`). */
export const YOUR_ARROW = "rgba(90,90,90,0.85)";
export const LEGEND_ARROW = "var(--cb-sky-500)";

/** The board copy and the compare copy use the typographic apostrophe, as the CA templates do. */
export const APOS = "’";

export function isCompareTab(v: unknown): v is CompareTab {
  return typeof v === "string" && (COMPARE_TABS as readonly string[]).includes(v);
}

export interface LineFrame {
  fen: string;
  last: [Square, Square] | null;
  check: Square | null;
  /** "12.Ba4" / "12…Rb8"; null for the start. */
  label: string | null;
}

function moveNo(i: number, startPly: number): number {
  return Math.floor((startPly + i) / 2) + 1;
}

/** "12." / "12…" for the i-th ply of a line (offset from `startPly`). */
export function moveLabelAt(i: number, startPly: number): string {
  return `${moveNo(i, startPly)}${(startPly + i) % 2 === 0 ? "." : "…"}`;
}

/** Replays a line (UCI, space-separated) from the start FEN. A move that does not replay ends the line there. */
export function lineFrames(startFen: string, uci: string, startPly: number): LineFrame[] {
  let chess: Chess;
  try {
    chess = new Chess(startFen);
  } catch {
    return [];
  }
  const check = (): Square | null => (chess.inCheck() ? (chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null) : null);
  const frames: LineFrame[] = [{ fen: chess.fen(), last: null, check: check(), label: null }];
  const moves = uci.trim() === "" ? [] : uci.trim().split(/\s+/);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]!;
    let san: string;
    try {
      san = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m.length > 4 ? m[4] : undefined }).san;
    } catch {
      break;
    }
    frames.push({ fen: chess.fen(), last: [m.slice(0, 2) as Square, m.slice(2, 4) as Square], check: check(), label: `${moveLabelAt(i, startPly)}${san}` });
  }
  return frames;
}

export interface CompareLines {
  yours: LineFrame[];
  legend: LineFrame[];
}

let memo: { key: string; lines: CompareLines } | null = null;

/** Both lines of a payload, replayed once per payload (a one-entry memo shared by the board, tables and stepper). */
export function compareLines(dto: Pick<LegendCompareDTO, "startFen" | "startPly" | "yourLine" | "legendLine">): CompareLines {
  const key = `${dto.startFen}|${dto.startPly}|${dto.yourLine.uci}|${dto.legendLine.uci}`;
  if (memo?.key === key) return memo.lines;
  const lines = { yours: lineFrames(dto.startFen, dto.yourLine.uci, dto.startPly), legend: lineFrames(dto.startFen, dto.legendLine.uci, dto.startPly) };
  memo = { key, lines };
  return lines;
}

/** The highest position index of a line. */
export function lastPos(lines: CompareLines, line: LineKey): number {
  return Math.max(0, lines[line].length - 1);
}

export interface CompareView {
  tab: CompareTab;
  line: LineKey;
  pos: number;
}

/** The position the screen opens on: the split (the position before the divergent move), else the end of your line. */
export function defaultPos(dto: Pick<LegendCompareDTO, "divergence">, lines: CompareLines): number {
  if (dto.divergence) return Math.min(dto.divergence.ply, lastPos(lines, "yours"));
  return lastPos(lines, "yours");
}

/** The line a tab steps along: Your Moves → yours, the legend's moves → legend; the others keep the current line. */
export function lineForTab(tab: CompareTab, current: LineKey): LineKey {
  if (tab === "your_moves") return "yours";
  if (tab === "legend_moves") return "legend";
  return current;
}

/** The first view from the URL (`?tab=`, `?ply=` = a position index on the tab's line), clamped to the payload. */
export function initialView(
  dto: Pick<LegendCompareDTO, "divergence">,
  lines: CompareLines,
  search: { tab?: string | null; ply?: string | null },
): CompareView {
  const tab: CompareTab = isCompareTab(search.tab) ? search.tab : "explanation";
  const line = lineForTab(tab, "yours");
  const n = search.ply != null && /^\d{1,4}$/.test(search.ply) ? Number(search.ply) : null;
  const pos = n === null ? defaultPos(dto, lines) : Math.min(n, lastPos(lines, line));
  return { tab, line, pos };
}

export function clampPos(lines: CompareLines, line: LineKey, pos: number): number {
  return Math.min(Math.max(0, pos), lastPos(lines, line));
}

export interface CompareBoard {
  fen: string;
  last: [Square, Square] | null;
  check: Square | null;
  arrows: { from: Square; to: Square; color: string }[];
  /** The board's accessible name. */
  label: string;
  /** "Move 12. Ba4" over the board / in the stepper; "Start" at index 0. */
  posLabel: string;
  /** True at the split (both arrows drawn). */
  atSplit: boolean;
}

const COLOUR = { w: "White", b: "Black" } as const;

function sideToMove(fen: string): Side {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

/** What the board shows for a view: the line's position, plus both arrows at the split. */
export function compareBoard(
  dto: Pick<LegendCompareDTO, "divergence" | "legend">,
  lines: CompareLines,
  view: Pick<CompareView, "line" | "pos">,
): CompareBoard {
  const frames = lines[view.line];
  const pos = clampPos(lines, view.line, view.pos);
  const frame = frames[pos] ?? frames[0] ?? { fen: "8/8/8/8/8/8/8/8 w - - 0 1", last: null, check: null, label: null };
  const name = dto.legend.name;
  const d = dto.divergence;
  const atSplit = !!d && pos === d.ply;
  const where = frame.label ? `Position after ${frame.label}` : "Starting position";
  const lineName = view.line === "yours" ? "your line" : `${name}${APOS}s line`;
  if (atSplit && d) {
    const mover = COLOUR[sideToMove(frame.fen)];
    const who = d.by === "user" ? "you played" : "the game went";
    return {
      fen: frame.fen,
      last: frame.last,
      check: frame.check,
      arrows: [
        { from: d.userUci.slice(0, 2) as Square, to: d.userUci.slice(2, 4) as Square, color: YOUR_ARROW },
        { from: d.legendUci.slice(0, 2) as Square, to: d.legendUci.slice(2, 4) as Square, color: LEGEND_ARROW },
      ],
      label: `${where}. ${mover} to move: ${who} ${d.moveLabel}${d.userSan}, ${name} played ${d.moveLabel}${d.legendSan}. The grey arrow is the game${APOS}s move, the blue arrow ${name}${APOS}s.`,
      posLabel: frame.label ? `Move ${frame.label}` : "Start",
      atSplit: true,
    };
  }
  return {
    fen: frame.fen,
    last: frame.last,
    check: frame.check,
    arrows: [],
    label: `${where} in ${lineName}.`,
    posLabel: frame.label ? `Move ${frame.label}` : "Start",
    atSplit: false,
  };
}

// ── The tables (Your Moves, the legend's moves) ──────────────────────────────────────────────────────────────────

export interface TableCell {
  san: string;
  /** The position index after this move on the table's line. */
  pos: number;
}

export interface TableRow {
  n: string;
  w: TableCell | null;
  b: TableCell | null;
  mark: LegendLineRow["mark"];
  /** The "Paths split here" divider goes above this row. */
  splitAbove: boolean;
}

/** The position index after the move of row `n` ("12.") by `colour`. */
export function posOfCell(n: string, colour: Side, startPly: number): number {
  const no = Number(n.replace(/\D/g, ""));
  const plyAbs = (no - 1) * 2 + (colour === "b" ? 1 : 0);
  return plyAbs - startPly + 1;
}

/** The table rows of a line with their positions, and the row the split divider sits above. */
export function tableRows(
  rows: readonly LegendLineRow[],
  startPly: number,
  divergence: Pick<NonNullable<LegendCompareDTO["divergence"]>, "ply"> | null,
): TableRow[] {
  const splitNo = divergence ? moveNo(divergence.ply, startPly) : null;
  return rows.map((r) => ({
    n: r.n,
    w: r.w ? { san: r.w, pos: posOfCell(r.n, "w", startPly) } : null,
    b: r.b ? { san: r.b, pos: posOfCell(r.n, "b", startPly) } : null,
    mark: r.mark,
    splitAbove: splitNo !== null && Number(r.n.replace(/\D/g, "")) === splitNo,
  }));
}

// ── Copy (sentence case; every number computed) ──────────────────────────────────────────────────────────────────

type CopyDto = Pick<
  LegendCompareDTO,
  "legend" | "divergence" | "outcomeLine" | "paragraph" | "legendResult" | "legendTotalMoves" | "you" | "practice" | "startPly"
>;

/** Your Moves tab's lead. */
export function yourMovesLead(dto: CopyDto): string {
  const name = dto.legend.name;
  const d = dto.divergence;
  if (!d) return `${dto.paragraph} ${dto.outcomeLine}`;
  if (d.by === "opponent") return `${dto.paragraph} ${dto.outcomeLine}`;
  return `You left ${name}${APOS}s path on ${d.moveLabel}${d.userSan}. ${dto.outcomeLine}`;
}

/** The legend's side won, lost or drew (the member plays the legend's colour). */
export function legendOutcome(dto: Pick<LegendCompareDTO, "legendResult" | "you">): "won" | "lost" | "drew" {
  if (dto.legendResult === "draw") return "drew";
  const winner: Side = dto.legendResult === "white_won" ? "w" : "b";
  return winner === dto.you ? "won" : "lost";
}

/** The legend's moves tab lead: "Morphy won in 17 moves. Morphy’s moves are in blue." */
export function legendMovesLead(dto: CopyDto): string {
  const name = dto.legend.name;
  const outcome = legendOutcome(dto);
  const moves = dto.legendTotalMoves;
  const head = moves ? `${name} ${outcome} in ${moves} ${moves === 1 ? "move" : "moves"}.` : `${name} ${outcome} this game.`;
  return `${head} ${name}${APOS}s moves are in blue and marked in the last column.`;
}

/** The practice tab's lead and the move number Practice starts from. */
export function practiceLead(dto: CopyDto): { lead: string; moveNo: number } {
  const n = moveNo(dto.practice.ply, dto.startPly);
  const d = dto.divergence;
  if (d && d.by === "user") {
    return { lead: `Play on from move ${n} against the engine and try ${dto.legend.name}${APOS}s move yourself.`, moveNo: n };
  }
  return { lead: `Play on from move ${n} against the engine.`, moveNo: n };
}

/** "Engine 1400 · untimed · not rated". */
export function engineTerms(botElo: number): string {
  return `Engine ${botElo} · untimed · not rated`;
}

/** The practice link with `from=compare` for `practice_started` (the DTO's href is `/practice?game=…&ply=…`). */
export function practiceHref(dto: Pick<LegendCompareDTO, "practice">): string {
  return `${dto.practice.href}${dto.practice.href.includes("?") ? "&" : "?"}from=compare`;
}

export type EvalRow =
  | { kind: "none" }
  | { kind: "ready"; text: string }
  | { kind: "pending"; text: string };

/** The "Win chances after the split" row: shown for a divergence of yours, a ghost until the evals arrive. */
export function evalRow(dto: Pick<LegendCompareDTO, "divergence" | "evalAtDivergence" | "legend" | "status" | "analysisStatus">): EvalRow {
  if (!dto.divergence || dto.divergence.by !== "user" || dto.status === "failed") return { kind: "none" };
  const e = dto.evalAtDivergence;
  if (e) {
    return { kind: "ready", text: `Win chances after the split: you ${Math.round(e.userWin)}% · ${dto.legend.name} ${Math.round(e.legendWin)}%` };
  }
  return dto.analysisStatus === "done"
    ? { kind: "pending", text: "Working out the win chances after the split…" }
    : { kind: "pending", text: "Win chances after the split appear when the game’s analysis finishes." };
}

/** A9b answers 410 `gone` after this many attempts (the contract's, from the zod-free module). */
export const COMPUTE_MAX_ATTEMPTS = LEGEND_COMPUTE_MAX_ATTEMPTS;

/**
 * The page's one A9b (plan §5.7, P3-D23): only when the evals are what is missing (a divergence of yours), the facts
 * exist, the game's analysis is done and attempts are left. Never on hover or prefetch: the screen calls it once on
 * mount (and on Try Again after a failure).
 */
export function needsCompute(dto: Pick<LegendCompareDTO, "status" | "analysisStatus" | "evalAtDivergence" | "divergence" | "attempts">, maxAttempts: number): boolean {
  return (
    dto.status === "facts_ready" &&
    dto.analysisStatus === "done" &&
    dto.evalAtDivergence === null &&
    dto.divergence?.by === "user" &&
    dto.attempts < maxAttempts
  );
}

/** Try Again after `status = failed` may queue another compute while attempts are left (A9b answers 410 after 3). */
export function canRetryCompute(dto: Pick<LegendCompareDTO, "status" | "attempts">, maxAttempts: number): boolean {
  return dto.status === "failed" && dto.attempts < maxAttempts;
}

/** legend_compare_opened.from: the link's `?from=`, else the same-site referrer's path. */
export function openedFrom(param: string | null, referrerPath: string | null): "game_over" | "archive" | "review_menu" {
  if (param === "game_over" || param === "archive" || param === "review_menu") return param;
  if (referrerPath?.startsWith("/game/")) return "game_over";
  if (referrerPath === "/games" || referrerPath?.startsWith("/games?")) return "archive";
  return "review_menu";
}

/** "0:51" from seconds. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A Win% or a share rounded down to a multiple of 10 (the registry's pct buckets). */
export function bucket10(n: number): number {
  return Math.max(0, Math.min(100, Math.floor(n / 10) * 10));
}
