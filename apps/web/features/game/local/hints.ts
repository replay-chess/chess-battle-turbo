// Hints and undo copy for bot games (phase-02 plan 8.14). Hint level 1 names the piece, level 2 adds the arrow and
// the move; two levels per position, a new position starts again at level 1. The best move of a position is
// searched once (full strength, `go movetime 300`) and reused for its second level.

import { hintView, nextHintLevel, positionKey, type HintTracker, type HintView } from "@repo/game-core/bot/hints";
import type { GameState } from "@repo/game-core/machine/types";

export interface HintSource {
  best(state: Pick<GameState, "startFen" | "moves">, signal?: AbortSignal): Promise<string | null>;
}

/** Best moves already searched, by position (the FEN without the move counters). Small; one game at a time. */
export class HintCache {
  private map = new Map<string, string>();

  get(fen: string): string | undefined {
    return this.map.get(positionKey(fen));
  }

  set(fen: string, uci: string): void {
    if (this.map.size > 64) this.map.clear();
    this.map.set(positionKey(fen), uci);
  }
}

export type HintOutcome =
  /** A new level was shown: count it (`hintShown`). */
  | { kind: "shown"; level: 1 | 2; view: HintView }
  /** Both levels were already shown for this position: show level 2 again, uncounted. */
  | { kind: "repeat"; view: HintView }
  | { kind: "cancelled" }
  | { kind: "none" };

/**
 * The next hint for the position in `state`. `tracker` is the local game's hint tracker (`LocalGame.hint`).
 * Throws when the engine fails (the caller shows the engine error zone).
 */
export async function nextHint(
  state: Pick<GameState, "fen" | "startFen" | "moves">,
  tracker: HintTracker | null,
  source: HintSource,
  cache: HintCache,
  signal?: AbortSignal,
): Promise<HintOutcome> {
  const level = nextHintLevel(tracker, state.fen);
  let best = cache.get(state.fen);
  if (!best) {
    const found = await source.best(state, signal);
    if (found === null) return { kind: "cancelled" };
    if (!found) return { kind: "none" };
    best = found;
    cache.set(state.fen, best);
  }
  const view = hintView(level ?? 2, state.fen, best);
  if (!view) return { kind: "none" };
  return level === null ? { kind: "repeat", view } : { kind: "shown", level, view };
}

/** "11.Bxb5+" / "11…Nbd7" for an absolute ply (1 = White's first move of the game). */
export function numberedSan(absolutePly: number, san: string): string {
  const moveNo = Math.floor((absolutePly - 1) / 2) + 1;
  return absolutePly % 2 === 1 ? `${moveNo}.${san}` : `${moveNo}…${san}`;
}

/**
 * The undo toast (plan 8.14): "Took back 11.Bxb5+ and 11…Nbd7." `firstPly` is the relative index (1-based) of the
 * first ply taken back, as `undo()` returns it; `startPly` is the game's absolute start.
 */
export function tookBackText(sans: readonly string[], firstPly: number, startPly: number): string {
  const parts = sans.map((san, i) => numberedSan(startPly + firstPly + i, san));
  if (parts.length === 0) return "Took back your last move.";
  return `Took back ${parts.join(" and ")}.`;
}
