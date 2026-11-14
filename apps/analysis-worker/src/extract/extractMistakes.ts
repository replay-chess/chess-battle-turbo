// Mistake Bank extraction for one game (phase-05 plan §8.1, §7.6 J1; owner decisions D-1, D-9).
//
// For each member side: the candidates (@repo/chess-analysis/bank/candidates: errors, ≤ 4, the key moments forced in)
// → uniqueness from the stored MultiPV-2 score (evals[i] vs second[i], puzzle/validAttack) → the line for scored
// puzzles (≤ 3 engine searches, lineBuilder.ts) → themes (the tagger, with the `rc:*` heuristics for review positions)
// → the rows of the §7.6 statements (bankStatements.ts). Only key-moment plies get a card (D-9); every candidate is a
// `Mistake` row and an occurrence. Pure apart from the injected engine searches, so the live analysis (J1, inside the
// final batch) and the EXTRACT_MISTAKES backfill extract the same rows from the same stored analysis.
import type { StoredLine } from "@repo/chess-analysis/analysis";
import { selectCandidates, type BankCandidate } from "@repo/chess-analysis/bank/candidates";
import {
  decodeMove,
  evalFor,
  isMateEval,
  JUDGEMENT_ENUM,
  mateMoves,
  moveNo,
  type Color,
} from "@repo/chess-analysis/codec";
import { epdHash } from "@repo/chess-analysis/epd";
import { extendLine, type LineSearch, type ReplySearch } from "@repo/chess-analysis/puzzle/line";
import { matesFor, puzzleVerdict } from "@repo/chess-analysis/puzzle/validAttack";
import type { Replay } from "@repo/chess-analysis/replay";
import { tagThemes } from "@repo/chess-analysis/themes/index";
import { WIN_CP_CLAMP } from "@repo/chess-analysis/winpct";
import { trainingDayAt } from "@repo/chess-training/day";
import { mistakeItemKey } from "@repo/chess-training/items";
import { matingMoves } from "@repo/chess-training/mates";
import { nextRelease } from "@repo/chess-training/release";
import { EXTRACT_VERSION } from "@repo/contracts/internal/jobs";
import { newGameRef } from "@repo/db/games";
import { Chess } from "chess.js";
import { JobAborted } from "../jobs/types";
import type { GameMember } from "../pipeline/types";
import type { BankRows, CardRow, DayRow, MistakeRow, OccurrenceRow } from "./bankStatements";

/** `mistakes."lastOpponentName"` is NOT NULL: a game side without a stored opponent name shows this. */
export const UNKNOWN_OPPONENT = "Opponent";
/** Review positions accept other first moves within 2 Win% of the best, at most this many (§8.1 step 5). */
export const ACCEPT_MAX = 5;
/** Other mates in one stored with a mating best move (the runner accepts any mate anyway; TrainItem.accept ≤ 6). */
export const ACCEPT_MATES_MAX = 6;

/**
 * The stored `accept` list: with a mating best move, EVERY other mate-in-1 of the position, from the legal moves and
 * not only the ≤ 2 MultiPV alternatives the analysis kept (plan §8.1 step 2, FIX-1 alt-mate); else a review position's
 * moves within 2 Win% of the best (step 5), and nothing for a scored puzzle.
 */
export function acceptOf(fen: string, best: string, isPuzzle: boolean, alts: readonly string[]): string[] {
  if (deliversMate(fen, best)) return matingMoves(fen).filter((m) => m !== best).slice(0, ACCEPT_MATES_MAX);
  return isPuzzle ? [] : alts.slice(0, ACCEPT_MAX);
}

export type ExtractSource = "live" | "import" | "backfill";

export interface ExtractInput {
  gameId: string;
  startPly: number;
  replay: Replay;
  /** game_analyses arrays (positions 0 … n; judgements per ply). */
  evals: readonly number[];
  second: readonly number[];
  best: readonly number[];
  judgements: readonly number[];
  /** game_analyses.lines (LinesV1): the flagged plies' pass-2 line and the moves within 2 Win% of the best. */
  lines: Readonly<Record<string, StoredLine>>;
  division: { middlegamePly: number | null; endgamePly: number | null };
  /** Key-moment plies per member side (PlayerReview.content.moments[*].ply). */
  moments: Partial<Record<Color, readonly number[]>>;
  /** The member sides to extract. */
  members: readonly GameMember[];
  completedAtMs: number | null;
  timeClass: string | null;
  ecoCode: string | null;
  colorUnknown: boolean;
  /** The job clock. */
  now: Date;
}

export interface ExtractDeps {
  /** Engine searches for puzzle lines; null = no engine (lines stay one move). */
  search: LineSearch | null;
  reply: ReplySearch | null;
  /** Called when a line extension failed and the puzzle kept its first move only (logged, counted). */
  onLineError?: (error: unknown) => void;
}

/** What one member side contributed (telemetry and the emit mapping). */
export interface MemberSummary {
  userId: string;
  userRef: string;
  color: Color;
  candidates: number;
  puzzles: number;
  reviewPositions: number;
  /** The side's key-moment plies (cards are created for those). */
  momentPlies: number[];
  /** Cap inputs for bankDue (§8.5). */
  cap: number;
  newPerDay: number;
}

export interface BankPlan extends BankRows {
  members: readonly MemberSummary[];
  source: ExtractSource;
  extractMs: number;
  lineSearches: number;
}

/** `timestamp(3)` text in UTC (never a time zone in jsonb_to_recordset). */
export function pgTimestamp(at: Date | number): string {
  return new Date(at).toISOString().replace("T", " ").replace("Z", "");
}

function phaseOf(ply: number, division: ExtractInput["division"]): MistakeRow["phase"] {
  if (division.endgamePly !== null && ply >= division.endgamePly) return "ENDGAME";
  if (division.middlegamePly !== null && ply >= division.middlegamePly) return "MIDDLEGAME";
  return "OPENING";
}

const pvOf = (line: StoredLine | undefined): string[] => (line?.pv ? line.pv.split(" ").filter(Boolean) : []);

/** The best move of a position: the pass-2 line's first move, else the stored pass-1 best move. */
export function bestAt(input: Pick<ExtractInput, "lines" | "best">, ply: number): string | null {
  return pvOf(input.lines[String(ply)])[0] ?? decodeMove(input.best[ply] ?? 0);
}

function deliversMate(fen: string, uci: string): boolean {
  const chess = new Chess(fen);
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return false;
  }
  return chess.isCheckmate();
}

function legalIn(fen: string, uci: string): boolean {
  try {
    new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return true;
  } catch {
    return false;
  }
}

/** One member side's rows. */
async function extractSide(
  input: ExtractInput,
  member: GameMember,
  deps: ExtractDeps,
  counter: { searches: number },
): Promise<{ summary: MemberSummary; mistakes: MistakeRow[]; occurrences: OccurrenceRow[]; cards: CardRow[]; day: DayRow }> {
  const { replay } = input;
  const color = member.color;
  const t = member.training;
  const timeZone = t?.timeZone ?? "UTC";
  const releaseHour = t?.releaseHour ?? 8;
  const due = pgTimestamp(nextRelease(input.now, timeZone, releaseHour));
  const playedAtMs = t?.endedAtMs ?? input.completedAtMs ?? input.now.getTime();
  const playedAt = pgTimestamp(playedAtMs);
  const opponent = (t?.opponentName?.trim() || UNKNOWN_OPPONENT).slice(0, 40);
  const momentPlies = [...(input.moments[color] ?? [])].sort((a, b) => a - b);
  const candidates = selectCandidates({
    judgements: input.judgements,
    evals: input.evals,
    side: color,
    startMover: replay.startMover,
    startPly: input.startPly,
    momentPlies,
    colorUnknown: input.colorUnknown,
    hasBest: (ply) => bestAt(input, ply) !== null,
  });
  const mistakes: MistakeRow[] = [];
  const occurrences: OccurrenceRow[] = [];
  const cards: CardRow[] = [];
  let puzzles = 0;
  for (const c of candidates) {
    const row = await recordOf(input, member, c, deps, counter, { due, playedAt, opponent });
    if (row.isPuzzle) puzzles++;
    occurrences.push({
      userId: member.userId,
      epdHash: row.epdHash,
      gameId: input.gameId,
      ply: c.ply,
      playedAt,
      due,
      moment: c.moment,
    });
    // The same position twice in one game: one mistake row (the later ply's), two occurrences.
    const same = mistakes.findIndex((m) => m.epdHash === row.epdHash);
    if (same >= 0) mistakes.splice(same, 1);
    mistakes.push(row);
    if (c.moment && !cards.some((k) => k.itemKey === mistakeItemKey(BigInt(row.epdHash)))) {
      cards.push({
        userId: member.userId,
        epdHash: row.epdHash,
        gameId: input.gameId,
        color,
        ply: c.ply,
        kind: row.isPuzzle ? "MISTAKE" : "REVIEW_POSITION",
        itemKey: mistakeItemKey(BigInt(row.epdHash)),
        due,
      });
    }
  }
  return {
    summary: {
      userId: member.userId,
      userRef: member.userRef,
      color,
      candidates: candidates.length,
      puzzles,
      reviewPositions: candidates.length - puzzles,
      momentPlies,
      cap: t?.bankDailyCap ?? 10,
      newPerDay: t?.newPerDay ?? 5,
    },
    mistakes,
    occurrences,
    cards,
    // Today as the web counts it: the day in progress stays pinned across a zone change (FIX-2).
    day: { userId: member.userId, day: trainingDayAt(input.now, timeZone, t?.dayStartHour ?? 4, t?.dayAnchor ?? null).key },
  };
}

async function recordOf(
  input: ExtractInput,
  member: GameMember,
  c: BankCandidate,
  deps: ExtractDeps,
  counter: { searches: number },
  at: { due: string; playedAt: string; opponent: string },
): Promise<MistakeRow> {
  const { replay } = input;
  const i = c.ply;
  const color = member.color;
  const fen = replay.fens[i] as string;
  const best = bestAt(input, i) as string;
  const line = input.lines[String(i)];
  const pv = pvOf(line);
  const evalBest = input.evals[i] as number;
  const verdict = puzzleVerdict({
    best: evalBest,
    second: input.second[i] as number,
    mover: color,
    legalCount: replay.legal[i] ?? 0,
    evalBeforeSetup: i >= 1 ? (input.evals[i - 1] ?? null) : null,
  });
  let solution = [best];
  if (verdict.isPuzzle && deps.search) {
    try {
      const out = await extendLine({ fen, best, pv, search: deps.search, ...(deps.reply ? { reply: deps.reply } : {}) });
      counter.searches += out.searches + out.replySearches;
      solution = out.line;
    } catch (error) {
      if (error instanceof JobAborted) throw error;
      deps.onLineError?.(error);
    }
  }
  const own = evalFor(evalBest, color);
  const mating = isMateEval(own);
  const setupUci = i >= 1 ? (replay.uci[i - 1] as string) : null;
  const setupCaptured = setupUci !== null && (replay.san[i - 1] ?? "").includes("x");
  const refuteUci = bestAt(input, i + 1);
  const alts = (line?.alts ?? []).filter((m) => m !== best && legalIn(fen, m));
  const accept = acceptOf(fen, best, verdict.isPuzzle, alts);
  const phase = phaseOf(i, input.division);
  const tagged = tagThemes({
    fen,
    line: solution,
    setupUci,
    setupCaptured,
    cp: mating ? null : Math.max(-WIN_CP_CLAMP, Math.min(WIN_CP_CLAMP, own)),
    mateIn: mating && matesFor(evalBest, color) ? mateMoves(evalBest) : null,
    review: verdict.isPuzzle ? null : { playedUci: replay.uci[i] as string, refuteUci, pv: pv.length ? pv : [best], phase },
  });
  const judgement = JUDGEMENT_ENUM[c.code];
  if (!judgement) throw new RangeError(`ply ${i} has no judgement`);
  return {
    referenceId: newGameRef(input.now.getTime()),
    userId: member.userId,
    epdHash: epdHash(fen).toString(),
    color,
    fen: i >= 1 ? (replay.fens[i - 1] as string) : fen,
    setupUci,
    solution: solution.join(" "),
    accept: accept.length ? accept.join(" ") : null,
    playedUci: replay.uci[i] as string,
    refuteUci,
    judgement,
    source: c.source,
    isPuzzle: verdict.isPuzzle,
    uniquenessGap: verdict.gap,
    themes: tagged.themes,
    primaryTheme: tagged.primary,
    phase,
    winBefore: c.winBefore,
    winAfterPlayed: c.winAfter,
    cpBest: mating ? null : Math.max(-WIN_CP_CLAMP, Math.min(WIN_CP_CLAMP, own)),
    mateBest: mating ? (own > 0 ? 1 : -1) * (mateMoves(own) ?? 0) : null,
    timeClass: input.timeClass,
    ecoCode: input.ecoCode,
    moveNumber: moveNo(i, input.startPly),
    lastGameId: input.gameId,
    lastPly: i,
    lastPlayedAt: at.playedAt,
    lastOpponentName: at.opponent,
    due: at.due,
  };
}

/** The extraction of every given member side (see the header). */
export async function buildBankPlan(
  input: ExtractInput,
  deps: ExtractDeps,
  meta: { source: ExtractSource; clockMs: () => number },
): Promise<BankPlan> {
  const started = meta.clockMs();
  const counter = { searches: 0 };
  const mistakes: MistakeRow[] = [];
  const occurrences: OccurrenceRow[] = [];
  const cards: CardRow[] = [];
  const days: DayRow[] = [];
  const members: MemberSummary[] = [];
  for (const m of input.members) {
    const side = await extractSide(input, m, deps, counter);
    mistakes.push(...side.mistakes);
    occurrences.push(...side.occurrences);
    cards.push(...side.cards);
    days.push(side.day);
    members.push(side.summary);
  }
  return {
    gameId: input.gameId,
    mistakes,
    occurrences,
    cards,
    days,
    userIds: members.map((m) => m.userId),
    momentPlies: members.flatMap((m) => m.momentPlies),
    version: EXTRACT_VERSION,
    members,
    source: meta.source,
    extractMs: Math.max(0, meta.clockMs() - started),
    lineSearches: counter.searches,
  };
}
