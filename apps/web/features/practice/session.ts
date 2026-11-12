// Practice's optional local resume (phase-03 plan §5.9: "An optional local resume lives in sessionStorage per URL
// (try/catch)"): the moves played from this URL's start position, so a reload or a back-and-forth keeps the game. Never
// sent anywhere. A stored game whose start differs from the page's (the position changed) or whose moves no longer
// replay is ignored.
import { playMove, type PracticeGame } from "./runner";

export const SESSION_PREFIX = "rc:practice:";
/** A practice line longer than this is not stored (a runaway game should not fill sessionStorage). */
export const SESSION_MAX_MOVES = 400;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function sessionKey(pathAndQuery: string): string {
  return `${SESSION_PREFIX}${pathAndQuery}`;
}

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The stored game for this URL, replay-checked, or null. */
export function readSession(key: string, startFen: string, store: StorageLike | null = storage()): PracticeGame | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { startFen?: unknown; moves?: unknown };
    if (v.startFen !== startFen || !Array.isArray(v.moves) || v.moves.length > SESSION_MAX_MOVES) return null;
    let game: PracticeGame | null = { startFen, moves: [] };
    for (const m of v.moves) {
      if (typeof m !== "string" || !game) return null;
      game = playMove(game, m);
    }
    return game;
  } catch {
    return null;
  }
}

export function writeSession(key: string, game: PracticeGame, store: StorageLike | null = storage()): void {
  try {
    if (game.moves.length === 0) store?.removeItem(key);
    else if (game.moves.length <= SESSION_MAX_MOVES) store?.setItem(key, JSON.stringify({ startFen: game.startFen, moves: game.moves }));
  } catch {
    // Private mode or a full quota: practice simply does not resume.
  }
}
