// The key-moment walkthrough's pure logic (phase-03 plan §4.1 `moment.*`, §8.5, §8.8; board V3KeyMoments): what the
// board shows in each phase, whether a try is correct (locally, against `moment.accept`, so it is instant), the best
// line replayed on the client (FENs are never sent, §9.6), the copy of each phase and the walkthrough tallies for
// `review_completed`. No React and no zod (the review chunk keeps zod out of production, AP-12).
//
// Index base (§8.1): `moment.ply` is the offset of the member's move from `game.startPly`; position `ply` is the one
// before it and position `ply + 1` the one after the move that was played.

import { Chess, type Square } from "chess.js";
import type { MomentDTO, MomentResult, PlanKey, ReviewProgressDTO } from "@repo/contracts/http/review";
import type { JudgementKey } from "@repo/chess-analysis/codec";
import { COLOUR_NAME, QUALITY_LABEL } from "./copy";
import { moveNumber, moverOf, type Plies, type Side } from "./model";

/** Show Line steps the best line at this pace (§4.1 `moment.line`); reduced motion jumps to the end. */
export const LINE_STEP_MS = 600;

/** The sub-states of a moment (§4.1). `pickLine` = a plan chip is picked and its feedback shows. */
export type MomentPhase = "ask" | "tried" | "found" | "found_retry" | "pickLine" | "reveal" | "line";

/** Phases where the member is still answering (board input on, chips on, the primary is Reveal the Answer). */
export function isAsking(phase: MomentPhase): boolean {
  return phase === "ask" || phase === "tried" || phase === "pickLine";
}

/** Phases after the answer (found or revealed): the why text, Show Line, the Next Moment / Finish Review primary. */
export function isAnswered(phase: MomentPhase): boolean {
  return phase === "found" || phase === "found_retry" || phase === "reveal" || phase === "line";
}

/** The plan chips in the board's order; keys 1–5 pick them (§4.1 shortcuts). Title Case labels (P1 rule). */
export const PLAN_CHIPS: readonly { key: PlanKey; label: string }[] = [
  { key: "attack", label: "Attack" },
  { key: "defend", label: "Defend" },
  { key: "trade", label: "Trade" },
  { key: "improve", label: "Improve a Piece" },
  { key: "unsure", label: "Not Sure" },
];

// ── Correctness (§8.5: found iff the move is in `accept`; the first try → FOUND, later tries → FOUND_RETRY) ─────

export interface TryVerdict {
  correct: boolean;
  /** The moment's result after this try; null while it is still open (a wrong try). */
  result: Extract<MomentResult, "found" | "found_retry"> | null;
  /** `best` when the move is the engine's first choice, `alt` for another move inside the 2 Win% window. */
  acceptedAs: "best" | "alt" | null;
}

/** Judges a try. `wrongBefore` = the wrong tries already made at this moment. Promotions compare with their piece. */
export function judgeTry(moment: Pick<MomentDTO, "accept" | "bestUci">, uci: string, wrongBefore: number): TryVerdict {
  const u = uci.toLowerCase();
  if (!moment.accept.some((a) => a.toLowerCase() === u)) return { correct: false, result: null, acceptedAs: null };
  return {
    correct: true,
    result: wrongBefore === 0 ? "found" : "found_retry",
    acceptedAs: u === moment.bestUci.toLowerCase() ? "best" : "alt",
  };
}

// ── The best line (Show Line), replayed once per moment ────────────────────────────────────────────────────────

export interface LinePly {
  uci: string;
  san: string;
  from: Square;
  to: Square;
  /** The position after this ply. */
  fen: string;
  /** The king in check after this ply, or null. */
  check: Square | null;
}

function kingInCheck(chess: Chess): Square | null {
  if (!chess.inCheck()) return null;
  return chess.findPiece({ type: "k", color: chess.turn() })[0] ?? null;
}

function applyUci(chess: Chess, uci: string) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
  } catch {
    return null;
  }
}

const lineMemo = new Map<string, LinePly[]>();

/** Replays `line` (space-separated UCI) from `fen`; stops at the first move that does not replay (never throws). */
export function lineOf(fen: string, line: string): LinePly[] {
  const key = `${fen}|${line}`;
  const hit = lineMemo.get(key);
  if (hit) return hit;
  const out: LinePly[] = [];
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return out;
  }
  for (const uci of line.trim() === "" ? [] : line.trim().split(/\s+/)) {
    const mv = applyUci(chess, uci);
    if (!mv) break;
    out.push({ uci, san: mv.san, from: mv.from, to: mv.to, fen: mv.after, check: kingInCheck(chess) });
  }
  if (lineMemo.size > 32) lineMemo.clear();
  lineMemo.set(key, out);
  return out;
}

/** One move from `fen` (the member's accepted try), or null when it does not replay. */
export function afterMove(fen: string, uci: string): LinePly | null {
  return lineOf(fen, uci)[0] ?? null;
}

/** SAN of a UCI move in `fen` ("Nd5"), or the UCI itself when it does not replay. */
export function sanOf(fen: string, uci: string): string {
  return afterMove(fen, uci)?.san ?? uci;
}

const destsMemo = new Map<string, Map<string, Square[]>>();

/** Legal target squares per from-square in `fen` (the moment board's `dests`). */
export function destsOf(fen: string): Map<string, Square[]> {
  const hit = destsMemo.get(fen);
  if (hit) return hit;
  const out = new Map<string, Square[]>();
  try {
    const chess = new Chess(fen);
    for (const m of chess.moves({ verbose: true })) {
      const list = out.get(m.from) ?? [];
      if (!list.includes(m.to)) list.push(m.to);
      out.set(m.from, list);
    }
  } catch {
    // An unreadable position takes no input.
  }
  if (destsMemo.size > 16) destsMemo.clear();
  destsMemo.set(fen, out);
  return out;
}

// ── What the board shows (V3KeyMoments: before / tried / found / reveal / line) ────────────────────────────────

export interface MomentBoardView {
  fen: string;
  lastMove: readonly [Square, Square] | null;
  check: Square | null;
  badge: { sq: Square; kind: JudgementKey; label: string } | null;
  arrows: { from: Square; to: Square; color: string }[];
  rings: Partial<Record<Square, string>>;
  highlights: Partial<Record<Square, string>>;
  /** The side that may play a try (asking phases only), else null. */
  mover: Side | null;
  /** The position label above the board and in the board's aria-label. */
  label: string;
  /**
   * The game position whose stored eval the eval bar shows: the played position after a reveal, else the position
   * before the moment (with best play the eval holds, so it also stands for the found move and the best line).
   */
  position: number;
}

/** DS colours: the wrong-try ring (#a3412e), the found square (highlight-green) and the best-move arrow (#7d9d3e). */
export const MOMENT_COLOURS = { ring: "cb-bad", found: "green", arrow: "mq-best" } as const;

export interface MomentBoardInput {
  plies: Plies;
  moment: MomentDTO;
  phase: MomentPhase;
  /** The last wrong try (UCI), for the rings. */
  tried: string | null;
  /** The accepted try (UCI) in found / found_retry. */
  accepted: string | null;
  /** Show Line: the plies of the best line played so far (0 = the start of the line). */
  lineN: number;
}

function sqPair(uci: string): [Square, Square] {
  return [uci.slice(0, 2) as Square, uci.slice(2, 4) as Square];
}

export function momentBoard({ plies, moment, phase, tried, accepted, lineN }: MomentBoardInput): MomentBoardView {
  const k = Math.min(Math.max(moment.ply, 0), plies.fens.length - 1);
  const before = plies.fens[k]!;
  const moveNo = moveNumber(plies.startPly, k);
  const prev = k > 0 ? plies.moves[k - 1] : undefined;
  const base: MomentBoardView = {
    fen: before,
    lastMove: prev ? [prev.from, prev.to] : null,
    check: plies.checks[k] ?? null,
    badge: null,
    arrows: [],
    rings: {},
    highlights: {},
    mover: null,
    label: `Before move ${moveNo} · ${COLOUR_NAME[moverOf(plies, k)]} to move`,
    position: k,
  };

  if (phase === "line") {
    const line = lineOf(before, moment.line);
    const n = Math.min(Math.max(lineN, 0), line.length);
    if (n === 0) return { ...base, label: `Best line from move ${moveNo}` };
    const p = line[n - 1]!;
    return {
      ...base,
      fen: p.fen,
      lastMove: [p.from, p.to],
      check: p.check,
      label: `Best line · ${line
        .slice(0, n)
        .map((x) => x.san)
        .join(" ")}`,
    };
  }

  if ((phase === "found" || phase === "found_retry") && accepted) {
    const p = afterMove(before, accepted);
    if (p) {
      const best = accepted.toLowerCase() === moment.bestUci.toLowerCase();
      const [bf, bt] = sqPair(moment.bestUci);
      return {
        ...base,
        fen: p.fen,
        lastMove: [p.from, p.to],
        check: p.check,
        badge: best ? { sq: p.to, kind: "best", label: QUALITY_LABEL.best } : null,
        highlights: { [p.to]: MOMENT_COLOURS.found },
        arrows: best ? [] : [{ from: bf, to: bt, color: MOMENT_COLOURS.arrow }],
        label: `You found ${p.san}`,
      };
    }
  }

  if (phase === "reveal") {
    const played = plies.moves[k];
    const [bf, bt] = sqPair(moment.bestUci);
    return {
      ...base,
      fen: plies.fens[k + 1] ?? before,
      lastMove: played ? [played.from, played.to] : null,
      check: plies.checks[k + 1] ?? null,
      badge: played ? { sq: played.to, kind: moment.judgement, label: QUALITY_LABEL[moment.judgement] } : null,
      arrows: [{ from: bf, to: bt, color: MOMENT_COLOURS.arrow }],
      label: `After ${moment.moveLabel}${moment.playedSan} · arrow shows ${moment.bestSan}`,
      position: k + 1,
    };
  }

  // ask, tried, pickLine: the position before the move, the previous move highlighted, input on.
  const rings: Partial<Record<Square, string>> = {};
  if (phase === "tried" && tried && tried.length >= 4) {
    const [f, t] = sqPair(tried);
    rings[f] = MOMENT_COLOURS.ring;
    rings[t] = MOMENT_COLOURS.ring;
  }
  return { ...base, rings, mover: moverOf(plies, k) };
}

// ── Copy (P1 rules: sentence case for statuses; numbers and SAN come from the payload, never typed) ────────────

export const MOMENT_COPY = {
  hint: "Play your move on the board, or pick your plan",
  chipsGroup: "What were you considering?",
  reveal: "Reveal the Answer",
  showLine: "Show Line",
  replayLine: "Replay Line",
  nextMoment: "Next Moment",
  finish: "Finish Review",
  previousMoment: "Previous Moment",
  lineLabel: "Best line",
} as const;

/** "Moment 1 of 3 · Move 17". */
export function momentHeader(index: number, total: number, moveNo: number): string {
  return `Moment ${index + 1} of ${total} · Move ${moveNo}`;
}

/** The wrong-try status (§4.1 `moment.tried`). */
export function triedLine(san: string): string {
  return `Not quite: ${san} isn’t the move here. Try again, or reveal the answer.`;
}

/** The found note (§4.1 `moment.found`). `san` = the accepted move; an alternative names the engine's move too. */
export function foundLine(m: Pick<MomentDTO, "bestSan" | "playedSan">, san: string, acceptedAs: "best" | "alt"): string {
  const lead = acceptedAs === "best" ? `You found it: ${m.bestSan} is the engine’s move.` : `You found it: ${san} is as good as the engine’s ${m.bestSan}.`;
  return `${lead} In the game you played ${m.playedSan}.`;
}

/** "You played 17.b3 · Inaccuracy". */
export function playedRow(m: Pick<MomentDTO, "moveLabel" | "playedSan" | "judgement">): string {
  return `You played ${m.moveLabel}${m.playedSan} · ${QUALITY_LABEL[m.judgement]}`;
}

/** "Best was Qc1 · green arrow". */
export function bestRow(m: Pick<MomentDTO, "bestSan">): string {
  return `Best was ${m.bestSan} · green arrow`;
}

/** The narration / coach text of a moment: the ask while answering, the why after. */
export function momentSentences(m: Pick<MomentDTO, "ask" | "why">, phase: MomentPhase): { t: string; v: boolean }[] {
  return isAsking(phase) ? [{ t: m.ask, v: false }] : m.why.map((s) => ({ t: s.t, v: s.v }));
}

// ── Resume and tallies ─────────────────────────────────────────────────────────────────────────────────────────

/** Where Start Review enters: the saved moment index while the walkthrough is unfinished, else the first. */
export function resumeIndex(progress: Pick<ReviewProgressDTO, "momentIndex" | "completedAt"> | null, moments: number): number {
  if (!progress || moments <= 0 || progress.completedAt) return 0;
  return Math.min(Math.max(progress.momentIndex, 0), moments - 1);
}

export interface WalkTally {
  moments: number;
  /** Found on the first try. */
  found: number;
  found_retry: number;
  revealed: number;
}

/** `review_completed` counts from this session's results (moment index → result). */
export function tallyResults(results: Readonly<Record<number, MomentResult>>, moments: number): WalkTally {
  const t: WalkTally = { moments, found: 0, found_retry: 0, revealed: 0 };
  for (let i = 0; i < moments; i++) {
    const r = results[i];
    if (r === "found") t.found++;
    else if (r === "found_retry") t.found_retry++;
    else if (r === "revealed") t.revealed++;
  }
  return t;
}

/** The next moment without a result after `from` (Finish the Last Moment, the partial complete page); null if none. */
export function firstOpenMoment(results: readonly (MomentResult | null)[]): number | null {
  const i = results.findIndex((r) => r === null);
  return i < 0 ? null : i;
}
