// Suggested grade, objective score, solve streak and the Again re-queue (phase-05 plan §8.3, §8.6). Browser-safe
// (the /grade subpath): the runner and the server run the same rules, so the suggestion the member sees and the score
// the server rates with cannot drift. No ts-fsrs, no Node built-ins.
import type { Grade } from "@repo/contracts/http/train";
import { REQUEUE_OFFSET, SESSION_ITEMS_MAX } from "./constants";

/** The four grades (`@repo/contracts/http/train` `Grade`, the one source; type-only, erased at runtime). */
export type GradeKey = Grade;
export const GRADE_KEYS = ["again", "hard", "good", "easy"] as const satisfies readonly GradeKey[];

/** What happened while solving one item. */
export interface SolveFlags {
  /** The solution was shown (menu, or after a wrong move). */
  shown: boolean;
  /** Wrong moves played. */
  wrongs: number;
  /** Hint steps used (0–2). */
  hints: number;
  /** A review position solved with an accepted move other than the engine's best. */
  acceptedNonBest?: boolean;
}

/** The grade the bar pre-selects (verbatim from the board `_rv0`): shown or wrong → Again, hint → Hard, else Good. */
export function suggestedGrade(f: SolveFlags): GradeKey {
  return f.shown || f.wrongs > 0 ? "again" : f.hints > 0 ? "hard" : "good";
}

/** Solved with no hint, no wrong move and no solution shown (an accepted non-best move on a review position counts). */
export function isFirstTry(f: SolveFlags): boolean {
  return !f.shown && f.wrongs === 0 && f.hints === 0;
}

/** The puzzle rating's score (§8.3): never the chosen grade. 1 clean, 0.5 with a hint, 0 after a wrong move or the solution. */
export function objectiveScore(f: SolveFlags): 0 | 0.5 | 1 {
  if (f.shown || f.wrongs > 0) return 0;
  return f.hints > 0 ? 0.5 : 1;
}

/** The solve streak after an item: +1 first try, unchanged with a hint, reset after a wrong move or the solution. */
export function solveStreakAfter(streak: number, f: SolveFlags): number {
  if (f.shown || f.wrongs > 0) return 0;
  return f.hints > 0 ? streak : streak + 1;
}

/** True when the solve streak was reset ("· streak reset"). */
export function streakReset(f: SolveFlags): boolean {
  return f.shown || f.wrongs > 0;
}

/**
 * The note under the grade bar. `bestSan` names the engine's best when a review position was solved with an
 * accepted other move ("Good enough. The engine's best was Qc1.").
 */
export function gradeNote(f: SolveFlags, opts: { bestSan?: string } = {}): string {
  if (f.shown) return "You saw the solution, so Again is suggested: it comes back in under 10 minutes.";
  if (f.wrongs > 0) return f.wrongs === 1 ? "One wrong try, so Again is suggested." : `${f.wrongs} wrong tries, so Again is suggested.`;
  if (f.hints > 0) return "Solved with a hint, so Hard is suggested.";
  if (f.acceptedNonBest && opts.bestSan) return `Good enough. The engine's best was ${opts.bestSan}.`;
  return "Solved first time. Pick Easy if it felt instant.";
}

/** The whole row of the §8.3 table for one item. */
export function gradeOutcome(f: SolveFlags, opts: { bestSan?: string } = {}) {
  return {
    suggested: suggestedGrade(f),
    note: gradeNote(f, opts),
    firstTry: isFirstTry(f),
    score: objectiveScore(f),
    streakReset: streakReset(f),
  };
}

/** `overridden` is logged when the member picks another grade than the suggestion (D-10). */
export function isOverridden(grade: GradeKey, suggested: GradeKey): boolean {
  return grade !== suggested;
}

// ── Again re-queue (§8.6; applied identically by the client and the server) ────────────────────────────────────

/** Where the pass-2 copy of item `i` goes: 3 items later, or at the end if fewer remain (`min(i + 4, length)`). */
export function requeueIndex(i: number, length: number): number {
  return Math.min(i + REQUEUE_OFFSET, length);
}

/** The minimal shape the re-queue needs: a session-local id and the pass. */
export interface RequeueItem {
  itemId: string;
  pass: 1 | 2;
}

/**
 * Inserts the pass-2 copy of `items[i]` after an Again: id + "b", pass 2, at `requeueIndex(i, length)`. A pass-2
 * item is never re-queued again, a copy that already exists is not added twice (replays are idempotent), and a list
 * that already holds SESSION_ITEMS_MAX items takes no copy.
 * `copy` builds the new item (the server swaps in the after-Again previews there).
 */
export function requeueAfterAgain<T extends RequeueItem>(items: readonly T[], i: number, copy: (item: T) => T): { items: T[]; requeued: boolean; at: number | null } {
  const item = items[i];
  if (!item || item.pass !== 1) return { items: [...items], requeued: false, at: null };
  const id = `${item.itemId}b`;
  if (items.some((it) => it.itemId === id)) return { items: [...items], requeued: false, at: null };
  // A full list takes no copy (SESSION_ITEMS_MAX): the Again still schedules the card.
  if (items.length >= SESSION_ITEMS_MAX) return { items: [...items], requeued: false, at: null };
  const at = requeueIndex(i, items.length);
  const next = [...items];
  next.splice(at, 0, { ...copy(item), itemId: id, pass: 2 });
  return { items: next, requeued: true, at };
}
