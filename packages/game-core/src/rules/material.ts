// Material balance (plan 8.19): P1 N3 B3 R5 Q9 per side from the FEN, shown on the side ahead ("+4 material").

import type { Side } from "../machine/types";
import { parsePlacement } from "./chess";

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 } as const;

export interface Material {
  w: number;
  b: number;
  /** Side ahead, or null when equal. */
  ahead: Side | null;
  /** Absolute difference. */
  diff: number;
}

export function materialOf(fen: string): Material {
  let w = 0;
  let b = 0;
  for (const p of parsePlacement(fen).values()) {
    if (p.color === "w") w += PIECE_VALUES[p.type];
    else b += PIECE_VALUES[p.type];
  }
  return { w, b, ahead: w > b ? "w" : b > w ? "b" : null, diff: Math.abs(w - b) };
}

/** "+4 material" for `side` when it is ahead, else "". */
export function materialLabel(fen: string, side: Side): string {
  const m = materialOf(fen);
  return m.ahead === side ? `+${m.diff} material` : "";
}
