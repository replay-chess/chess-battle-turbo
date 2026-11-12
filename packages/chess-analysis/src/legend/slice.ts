// The legend game's continuation from a legend position (phase-03 plan §8.9). Ported from the legacy analysis route
// `apps/web/app/api/analysis/[gameId]/route.ts` (lines 42–129 at dev 5009248): `parseResultFromMetadata`,
// `getUserGameOutcome` and `parsePgnFromMoveNumber`, which the old `/analysis` page used and H4 deletes.
//
// Differences from the legacy helpers, all of them fixes:
// - `legendLineFrom` checks that the sliced position really is the game's start position (piece placement and side
//   to move). The legacy code sliced at (moveNumber − 1)·2 (+1 for Black) and trusted it; a position whose stored
//   move number disagrees with its PGN (seed data errors, plan R12) silently compared against the wrong moves. When
//   the move number is off, the first position of the PGN that matches the start FEN is used; when none does, there
//   is no legend line (null) rather than a wrong one.
// - The result also falls back to the PGN's own `[Result]` header and termination token when the metadata has none.
// - Outcomes for P2 games come from `games.outcome` (WHITE / BLACK / DRAW / NONE) and the member's colour
//   (`outcomeForMember`); `legacyUserOutcome` keeps the creator/opponent mapping for pre-P2 rows.

import { Chess } from "chess.js";
import type { Color } from "../codec";

export type LegendResult = "white_won" | "black_won" | "draw";
export type MemberOutcome = "win" | "loss" | "draw";

/** Ported `parseResultFromMetadata`: "1-0" / "white_won" / "white" etc. → LegendResult. */
export function parseResultFromMetadata(meta: Record<string, unknown> | null | undefined): LegendResult | null {
  if (!meta) return null;
  const result = meta.result;
  if (typeof result !== "string" || !result) return null;
  return parseResultToken(result);
}

function parseResultToken(raw: string): LegendResult | null {
  const normalized = raw.toLowerCase().trim();
  if (normalized === "1-0" || normalized === "white_won" || normalized === "white") return "white_won";
  if (normalized === "0-1" || normalized === "black_won" || normalized === "black") return "black_won";
  if (normalized === "1/2-1/2" || normalized === "draw" || normalized === "0.5-0.5" || normalized === "½-½") {
    return "draw";
  }
  return null;
}

/** The result a PGN records: its `[Result "…"]` header, else the termination token after the moves. */
export function resultFromPgn(pgn: string): LegendResult | null {
  const header = /\[Result\s+"([^"]*)"\]/.exec(pgn);
  if (header) {
    const r = parseResultToken(header[1] ?? "");
    if (r) return r;
  }
  const tail = /(1-0|0-1|1\/2-1\/2)\s*$/.exec(pgn.trim());
  return tail ? parseResultToken(tail[1] as string) : null;
}

/** The legend game's result: the position's metadata first (the legacy rule), then the PGN. */
export function legendResultOf(
  pgn: string | null,
  meta: Record<string, unknown> | null | undefined,
): LegendResult | null {
  return parseResultFromMetadata(meta) ?? (pgn ? resultFromPgn(pgn) : null);
}

/** Ported `getUserGameOutcome` for pre-P2 games (creator/opponent results). */
export function legacyUserOutcome(gameResult: string | null, isCreator: boolean): MemberOutcome | null {
  if (!gameResult) return null;
  if (gameResult === "DRAW") return "draw";
  const creatorWon = gameResult === "CREATOR_WON" || gameResult === "OPPONENT_TIMEOUT";
  const opponentWon = gameResult === "OPPONENT_WON" || gameResult === "CREATOR_TIMEOUT";
  if (isCreator) {
    if (creatorWon) return "win";
    if (opponentWon) return "loss";
  } else {
    if (opponentWon) return "win";
    if (creatorWon) return "loss";
  }
  return null;
}

/** The member's outcome from P2's `games.outcome` (GameWinner). NONE (aborted) and null give null. */
export function outcomeForMember(
  outcome: "WHITE" | "BLACK" | "DRAW" | "NONE" | null,
  member: Color,
): MemberOutcome | null {
  if (outcome === "DRAW") return "draw";
  if (outcome === "WHITE") return member === "w" ? "win" : "loss";
  if (outcome === "BLACK") return member === "b" ? "win" : "loss";
  return null;
}

/** The ply number of a FEN (games."startPly"): 2·(fullmove − 1) + (Black to move ? 1 : 0). */
export function startPlyOfFen(fen: string): number {
  const parts = fen.trim().split(/\s+/);
  const full = Number(parts[5] ?? "1");
  return 2 * ((Number.isInteger(full) && full >= 1 ? full : 1) - 1) + (parts[1] === "b" ? 1 : 0);
}

/** Ported `parsePgnFromMoveNumber`'s index: where a game at `moveNumber` with `sideToMove` starts. */
export function sliceIndex(moveNumber: number, sideToMove: Color): number {
  return (Math.max(1, moveNumber) - 1) * 2 + (sideToMove === "b" ? 1 : 0);
}

function placementAndTurn(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 2).join(" ");
}

export interface LegendLine {
  /** UCI of the legend's moves from the start position on. */
  uci: string[];
  san: string[];
  /** Index (plies from the PGN's first position) where the line starts. */
  startIndex: number;
  /** The legend game's length in full moves ("Morphy won in 17 moves"). */
  totalMoves: number;
}

/**
 * The legend's moves from `startFen` on (the ported `parsePgnFromMoveNumber`, with the start-position check described
 * in the header). `moveNumber` defaults to the FEN's full-move number. Null when the PGN does not parse or never
 * reaches the start position.
 */
export function legendLineFrom(pgn: string, startFen: string, moveNumber?: number): LegendLine | null {
  const game = new Chess();
  try {
    game.loadPgn(pgn, { strict: false });
  } catch {
    return null;
  }
  const history = game.history({ verbose: true });
  if (history.length === 0) return null;
  const target = placementAndTurn(startFen);
  const fenAt = (i: number) => (i === 0 ? history[0]!.before : history[i - 1]!.after);
  const side = (startFen.trim().split(/\s+/)[1] === "b" ? "b" : "w") as Color;
  const full = Number(startFen.trim().split(/\s+/)[5] ?? "1");
  const preferred = sliceIndex(moveNumber ?? (Number.isInteger(full) ? full : 1), side);
  let start = -1;
  if (preferred <= history.length && placementAndTurn(fenAt(preferred)) === target) start = preferred;
  else {
    for (let i = 0; i <= history.length; i++) {
      if (placementAndTurn(fenAt(i)) === target) {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return null;
  const rest = history.slice(start);
  const last = history[history.length - 1]!;
  const lastParts = last.after.split(/\s+/);
  const lastFull = Number(lastParts[5]);
  return {
    uci: rest.map((m) => `${m.from}${m.to}${m.promotion ?? ""}`),
    san: rest.map((m) => m.san),
    startIndex: start,
    totalMoves: lastParts[1] === "b" ? lastFull : lastFull - 1,
  };
}
