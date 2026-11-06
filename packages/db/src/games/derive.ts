// Creation-time derivations for live games (phase-02 plan 8.2, 8.11, 8.19).
//
// `@repo/db` stays free of `@repo/game-core` (the socket and web import both; the DB layer must not pull the rules
// engine). These are the few pure rules the writers need. game-core's `rules/timeClass.ts` and `constants.ts` are
// the canonical copies; `derive.test.ts` pins the same table so a drift between the two shows up in CI.
import type { TimeClass } from "../live/types";

export const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** `STUDY_SECONDS_NON_INITIAL` (owner Q1). */
export const STUDY_SECONDS_NON_INITIAL = 30;

/** Owner Q1: 30 s of study when the game starts from anything but the initial position, else 0. */
export function studySecondsFor(startingFen: string): number {
  return normaliseFen(startingFen) === normaliseFen(INITIAL_FEN) ? 0 : STUDY_SECONDS_NON_INITIAL;
}

/** Plan 8.11: estimated = initial + 40 × increment. `null` time control = untimed (bot games only). */
export function timeClassOf(tc: { initialSeconds: number; incrementSeconds: number } | null): TimeClass {
  if (!tc) return "UNTIMED";
  const estimated = tc.initialSeconds + 40 * tc.incrementSeconds;
  if (estimated < 180) return "BULLET";
  if (estimated < 480) return "BLITZ";
  if (estimated < 1500) return "RAPID";
  return "CLASSICAL";
}

/** Side to move of a FEN ("w" when the field is missing or unreadable). */
export function sideToMoveOf(fen: string): "w" | "b" {
  return fen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
}

/** Plan 8.19: startPly = 2·(fullmove − 1) + (side = b ? 1 : 0). */
export function startPlyOf(fen: string): number {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Number.parseInt(fields[5] ?? "1", 10);
  const moveNo = Number.isFinite(fullmove) && fullmove >= 1 ? fullmove : 1;
  return 2 * (moveNo - 1) + (fields[1] === "b" ? 1 : 0);
}

/** Side to move after `plyCount` plies from `startingFen`. */
export function sideToMoveAfter(startingFen: string, plyCount: number): "w" | "b" {
  const start = sideToMoveOf(startingFen);
  return plyCount % 2 === 0 ? start : start === "w" ? "b" : "w";
}

/** The bot's display name in the snapshot columns ("Engine 1400"). */
export function botDisplayName(elo: number): string {
  return `Engine ${elo}`;
}

/** Fits a display name into the VarChar(40) snapshot columns. */
export function clipName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = name.trim();
  return trimmed === "" ? null : trimmed.slice(0, 40);
}

/** Fits a title into VarChar(4) ("GM", "WFM"). */
export function clipTitle(title: string | null | undefined): string | null {
  if (title == null) return null;
  const trimmed = title.trim();
  return trimmed === "" ? null : trimmed.slice(0, 4);
}

/** A rating that fits SMALLINT, or null. */
export function clampRating(rating: number | null | undefined): number | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  return Math.max(0, Math.min(32767, Math.round(rating)));
}

function normaliseFen(fen: string): string {
  // Compare placement, side, castling and en passant; the move counters do not make a position non-initial.
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}
