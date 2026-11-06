// Server-side adjudication of a bot game's `complete` (plan 8.16; fixes "bot games trust the browser", SEC-07).
// Board-verifiable endings must hold on the board; resignation, timeout, agreement and abort are accepted as claimed
// only within the constraints below (these games are unrated).

import { ADJUDICATE_CLOCK_TOLERANCE_MS, ADJUDICATE_TIMEOUT_MAX_MS } from "./constants";
import type { EndMethod, Side } from "./machine/types";
import { buildPgn, type PgnInput } from "./pgn";
import { Chess, applyUci, sideToMove, splitMoves } from "./rules/chess";
import { detectEnd, isBoardMethod } from "./rules/end";
import { flagOutcome } from "./rules/insufficient";

export type ClaimResult = Side | "draw" | "aborted";
export type Outcome = "WHITE" | "BLACK" | "DRAW" | "NONE";

export interface AdjudicateInput {
  startFen: string;
  moves: string | readonly string[];
  clocksMs: readonly number[];
  /** null for untimed bot games. */
  initialMs: number | null;
  incMs: number;
  /** The human's colour; the bot is the other side. */
  humanSide: Side;
  /**
   * Server-measured wall time since the game started (now − startedAt). Required for a claim that the BOT ran out of
   * time (plan 8.16 "final remaining < 1 s", SEC-07): without it such a claim is refused (FIX-A).
   */
  elapsedMs?: number;
  claim: {
    result: ClaimResult;
    method: EndMethod;
    /** Optional: the flagging side's remaining ms when the client ended the game on time. */
    flagRemainingMs?: number;
  };
  /** When given, the PGN is built for the accepted result. */
  pgn?: Omit<PgnInput, "startFen" | "moves" | "clocksMs" | "result" | "tc">;
}

export type AdjudicateReason =
  | "illegal_move"
  | "terminal_before_end"
  | "board_mismatch"
  | "winner_mismatch"
  | "bot_resigned"
  | "untimed_timeout"
  | "timeout_clock"
  | "too_few_plies"
  | "too_many_plies"
  | "not_claimable"
  | "clock_length"
  | "clock_range"
  | "clock_increase";

export type AdjudicateResult =
  | {
      ok: true;
      outcome: Outcome;
      method: EndMethod;
      winner: Side | null;
      finalFen: string;
      plies: number;
      pgn: string | null;
    }
  | { ok: false; code: "illegal_moves" | "claim_mismatch"; reason: AdjudicateReason; ply?: number };

const mismatch = (reason: AdjudicateReason, ply?: number): AdjudicateResult => ({
  ok: false,
  code: "claim_mismatch",
  reason,
  ...(ply !== undefined ? { ply } : {}),
});

export function outcomeOf(winner: Side | null, method: EndMethod): Outcome {
  if (method === "aborted") return "NONE";
  if (winner === "w") return "WHITE";
  if (winner === "b") return "BLACK";
  return "DRAW";
}

export function adjudicate(input: AdjudicateInput): AdjudicateResult {
  const moves = splitMoves(input.moves);
  const { claim } = input;
  let chess: Chess;
  try {
    chess = new Chess(input.startFen);
  } catch {
    return { ok: false, code: "illegal_moves", reason: "illegal_move", ply: 0 };
  }

  // 1 + 2: replay; no position before the last may be terminal.
  for (let i = 0; i < moves.length; i++) {
    if (detectEnd(chess)) return mismatch("terminal_before_end", i);
    if (!applyUci(chess, moves[i]!)) return { ok: false, code: "illegal_moves", reason: "illegal_move", ply: i + 1 };
  }
  const n = moves.length;
  const finalEnd = detectEnd(chess);

  // 5: clocks.
  const clockErr = checkClocks(input, n);
  if (clockErr) return clockErr;

  const claimedWinner: Side | null = claim.result === "w" || claim.result === "b" ? claim.result : null;
  const bot: Side = input.humanSide === "w" ? "b" : "w";

  if (finalEnd) {
    // 3: the runner auto-ends a terminal position, so the claim must name it exactly.
    if (claim.method !== finalEnd.method) return mismatch("board_mismatch");
    if (finalEnd.winner !== claimedWinner || (finalEnd.winner === null && claim.result !== "draw")) {
      return mismatch("winner_mismatch");
    }
    return accept(input, chess, n, finalEnd.winner, finalEnd.method);
  }
  if (isBoardMethod(claim.method)) return mismatch("board_mismatch");

  // 4: claimed methods.
  switch (claim.method) {
    case "resignation":
      if (claim.result !== bot) return mismatch(claim.result === input.humanSide ? "bot_resigned" : "winner_mismatch");
      return accept(input, chess, n, bot, "resignation");
    case "timeout":
    case "timeout_vs_insufficient": {
      if (input.initialMs == null) return mismatch("untimed_timeout");
      const flagged = chess.turn();
      const expected = flagOutcome(chess.fen(), flagged);
      if (claim.method !== expected.method) return mismatch("board_mismatch");
      if (expected.winner !== claimedWinner || (expected.winner === null && claim.result !== "draw")) {
        return mismatch("winner_mismatch");
      }
      if (claim.flagRemainingMs !== undefined && claim.flagRemainingMs >= ADJUDICATE_TIMEOUT_MAX_MS) {
        return mismatch("timeout_clock");
      }
      if (flagged === bot && botRemainingLowerBound(input, n) >= ADJUDICATE_TIMEOUT_MAX_MS) {
        return mismatch("timeout_clock");
      }
      return accept(input, chess, n, expected.winner, expected.method);
    }
    case "agreement":
      if (n < 2) return mismatch("too_few_plies");
      if (claim.result !== "draw") return mismatch("winner_mismatch");
      return accept(input, chess, n, null, "agreement");
    case "aborted":
      if (n >= 2) return mismatch("too_many_plies");
      if (claim.result !== "aborted") return mismatch("winner_mismatch");
      return accept(input, chess, n, null, "aborted");
    default:
      return mismatch("not_claimable");
  }
}

/**
 * The least time the bot can still have had on its clock, from server facts only (FIX-A, SEC-07). Both clocks ran
 * for at most the wall time since the start (`elapsedMs`), and the human used at least `initial − its last clock` of
 * it, so the bot spent at most the rest, and kept at least `initial − that` (increments only add). A claim that the
 * bot flagged is accepted only when this bound is under ADJUDICATE_TIMEOUT_MAX_MS. No `elapsedMs` → Infinity.
 */
export function botRemainingLowerBound(input: AdjudicateInput, plies: number): number {
  if (input.initialMs == null) return 0;
  if (input.elapsedMs === undefined || !Number.isFinite(input.elapsedMs)) return Number.POSITIVE_INFINITY;
  const first = sideToMove(input.startFen);
  let humanLast = input.initialMs;
  for (let i = Math.min(plies, input.clocksMs.length) - 1; i >= 0; i--) {
    const mover: Side = i % 2 === 0 ? first : first === "w" ? "b" : "w";
    if (mover === input.humanSide) {
      humanLast = input.clocksMs[i]!;
      break;
    }
  }
  const humanSpentAtLeast = Math.max(0, input.initialMs - humanLast);
  const botSpentAtMost = Math.max(0, input.elapsedMs - humanSpentAtLeast);
  return input.initialMs - botSpentAtMost;
}

function checkClocks(input: AdjudicateInput, n: number): AdjudicateResult | null {
  const c = input.clocksMs;
  if (input.initialMs == null) return c.length === 0 ? null : mismatch("clock_length");
  if (c.length === 0) return null;
  if (c.length !== n) return mismatch("clock_length");
  const max = input.initialMs + input.incMs * n;
  for (let i = 0; i < n; i++) {
    const v = c[i]!;
    if (!Number.isFinite(v) || v < 0 || v > max) return mismatch("clock_range", i + 1);
    const prev = i >= 2 ? c[i - 2]! : input.initialMs;
    if (v > prev + input.incMs + ADJUDICATE_CLOCK_TOLERANCE_MS) return mismatch("clock_increase", i + 1);
  }
  return null;
}

function accept(
  input: AdjudicateInput,
  chess: Chess,
  plies: number,
  winner: Side | null,
  method: EndMethod,
): AdjudicateResult {
  const pgn =
    input.pgn && method !== "aborted"
      ? buildPgn({
          ...input.pgn,
          startFen: input.startFen,
          moves: input.moves,
          clocksMs: input.clocksMs,
          result: { winner, method },
          tc: input.initialMs == null ? null : { initialMs: input.initialMs, incrementMs: input.incMs },
        })
      : null;
  return { ok: true, outcome: outcomeOf(winner, method), method, winner, finalFen: chess.fen(), plies, pgn };
}
