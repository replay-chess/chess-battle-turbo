// /dev/ui/practice (phase-03 plan §4.10): the practice screen in each state of DR/V3Practice (default,
// engine_loading, engine_failed, offline) and the `over` variant, for each entry form (game, position, fen), on the
// contract fixtures. `default` and `offline` run the real browser engine; the loading and failed states are forced
// (no worker starts).
import { practiceContextFixture } from "@repo/contracts/http/fixtures/review";
import type { PracticeContextDTO } from "@repo/contracts/http/practice";
import type { ForcedEngine } from "../usePracticeEngine";

export const PRACTICE_DEMO_STATES = ["default", "engine_loading", "engine_failed", "offline", "over"] as const;
export type PracticeDemoState = (typeof PRACTICE_DEMO_STATES)[number];
export const PRACTICE_DEMO_SOURCES = ["game", "position", "fen"] as const;
export type PracticeDemoSource = (typeof PRACTICE_DEMO_SOURCES)[number];

export function isPracticeDemoState(v: unknown): v is PracticeDemoState {
  return typeof v === "string" && (PRACTICE_DEMO_STATES as readonly string[]).includes(v);
}
export function isPracticeDemoSource(v: unknown): v is PracticeDemoSource {
  return typeof v === "string" && (PRACTICE_DEMO_SOURCES as readonly string[]).includes(v);
}

/** Fool's mate: White to move and checkmated (the `over` variant, "Checkmate · the engine won"). */
export const MATED_FEN = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
/** The forced loading state's bar (the board's 34 %). */
export const DEMO_LOADING_PCT = 34;

export function practiceDemoContext(state: PracticeDemoState, source: PracticeDemoSource, stress = false): PracticeContextDTO {
  const base = practiceContextFixture(source);
  const ctx: PracticeContextDTO =
    state === "over" ? { ...base, fen: MATED_FEN, sideToMove: "w", humanColor: "w", title: "Practice from a position", fromLabel: null, compareHref: null, planLine: null } : base;
  if (!stress) return ctx;
  return {
    ...ctx,
    title: "Find Morphy’s queen sacrifice and the mate on the back rank that finishes the Opera Game",
    fromLabel: ctx.fromLabel ? `${ctx.fromLabel} · Opera Game, Paris 1858` : null,
  };
}

export function practiceDemoEngine(state: PracticeDemoState): ForcedEngine {
  if (state === "engine_loading") return { status: "loading", pct: DEMO_LOADING_PCT };
  if (state === "engine_failed") return { status: "failed" };
  return null;
}
