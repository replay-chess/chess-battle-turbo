// Timeout vs insufficient material (plan 8.9). When side S flags, the game is a draw if the OTHER side has only a
// king, king + one knight, or king + one bishop (no pawns, rooks or queens), regardless of S's material
// (Chess.com's rule, api-design rule 8). Finer Lichess helpmate cases (K+N vs K+P …) are known differences.

import type { EndMethod, Side } from "../machine/types";
import { parsePlacement } from "./chess";

export interface SideMaterial {
  p: number;
  n: number;
  b: number;
  r: number;
  q: number;
}

export function materialCount(fen: string): Record<Side, SideMaterial> {
  const out: Record<Side, SideMaterial> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const piece of parsePlacement(fen).values()) {
    if (piece.type === "k") continue;
    out[piece.color][piece.type]++;
  }
  return out;
}

/** True when `side` still has mating material for the purpose of a flag (more than K, K+N or K+B). */
export function canWinOnTime(fen: string, side: Side): boolean {
  const m = materialCount(fen)[side];
  if (m.p || m.r || m.q) return true;
  return m.n + m.b >= 2;
}

/** Outcome when `flagged` runs out of time in position `fen`. */
export function flagOutcome(
  fen: string,
  flagged: Side,
): { method: Extract<EndMethod, "timeout" | "timeout_vs_insufficient">; winner: Side | null } {
  const other: Side = flagged === "w" ? "b" : "w";
  return canWinOnTime(fen, other)
    ? { method: "timeout", winner: other }
    : { method: "timeout_vs_insufficient", winner: null };
}
