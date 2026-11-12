// The review's client-owned view state (phase-03 plan §5.2 "View state"; client-data-layer D7): a vanilla Zustand
// store per ReviewScreen instance. Server data never lives here (it is the TanStack Query cache, `qk.review.*`).
//
// Fields: `ply` (the ply on the board, −1 = start), `flipped`, `tab`, `mode` (moves vs a key moment) with the moment
// sub-state (`momentIndex`, `phase`, `tried`, `accepted`, `wrong`, `planChip`, `lineN`), this session's walkthrough
// results (`results`, `attempts`, `walkStartedAt`, for `review_completed`), `writing` (the `analysis:writing` flag,
// which the payload does not carry), and the walkthrough events queued for A5 (useReviewProgressSync).
// The URL keeps `?tab`, `?ply` and `?m` with history.replaceState (CDL D8); see `urlFor`.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { MomentResult, PlanKey, ProgressEvent } from "@repo/contracts/http/review";
import type { MomentPhase } from "./moments";

export type ReviewTab = "coach" | "moves";
export type { MomentPhase };

export interface ReviewView {
  ply: number;
  flipped: boolean;
  tab: ReviewTab;
  mode: "moves" | "moment";
  momentIndex: number;
  phase: MomentPhase;
  /** The last wrong try (UCI), for the rings, and its SAN for the status line. */
  tried: string | null;
  triedSan: string | null;
  /** The accepted try (UCI) in found / found_retry, and whether it was the engine's first choice. */
  accepted: string | null;
  acceptedAs: "best" | "alt" | null;
  /** Wrong tries at the current moment (attempt numbers, `moment_attempt.attempt_no`). */
  wrong: number;
  planChip: PlanKey | null;
  /** Show Line: −1 off, else the plies of the best line played so far. */
  lineN: number;
  /** This session's result per moment index (the first terminal result wins, as A5 does). */
  results: Record<number, MomentResult>;
  /** Tries per moment index up to its result (`moment_revealed.attempts`). */
  attempts: Record<number, number>;
  /** When Start Review was pressed (review_completed.duration_ms); null before. */
  walkStartedAt: number | null;
  writing: boolean;
  /** Walkthrough events waiting for A5 (≤ PROGRESS_EVENTS_MAX per send). */
  pending: ProgressEvent[];
}

export interface ReviewViewActions {
  setPly(ply: number): void;
  setTab(tab: ReviewTab): void;
  flip(): void;
  setWriting(writing: boolean): void;
  /** Enters a key moment (Start Review, Next/Previous Moment, `?m=`); a new moment starts at `ask`. */
  enterMoment(index: number): void;
  /** Back to the move list (Esc from a moment, the end of the walkthrough). */
  leaveMoments(): void;
  setPhase(
    phase: MomentPhase,
    patch?: Partial<Pick<ReviewView, "tried" | "triedSan" | "accepted" | "acceptedAs" | "wrong" | "planChip" | "lineN">>,
  ): void;
  /** Records the current moment's result unless it already has one (first terminal result wins). */
  settleMoment(result: MomentResult, attempts: number): void;
  startWalk(at: number): void;
  queueEvent(event: ProgressEvent): void;
  /** Takes the queued events (A5 send). */
  drainEvents(): ProgressEvent[];
  /** Puts events back at the front of the queue (a failed send is retried once). */
  requeueEvents(events: ProgressEvent[]): void;
}

export type ReviewViewStore = StoreApi<ReviewView & ReviewViewActions>;

export interface ReviewViewInit {
  ply: number;
  tab?: ReviewTab;
  /** 0-based moment index from `?m=` (1-based in the URL). */
  momentIndex?: number | null;
  flipped?: boolean;
  /** The demo's `writing` state (live screens learn it from `analysis:writing`). */
  writing?: boolean;
  /** The demo's moment sub-state (`/dev/ui/review?state=moment&phase=…`). */
  phase?: Partial<Pick<ReviewView, "phase" | "tried" | "triedSan" | "accepted" | "acceptedAs" | "wrong" | "planChip" | "lineN">>;
}

const MOMENT_RESET = {
  phase: "ask" as MomentPhase,
  tried: null,
  triedSan: null,
  accepted: null,
  acceptedAs: null,
  wrong: 0,
  planChip: null,
  lineN: -1,
};

export function createReviewViewStore(init: ReviewViewInit): ReviewViewStore {
  const inMoment = init.momentIndex !== null && init.momentIndex !== undefined;
  return createStore<ReviewView & ReviewViewActions>()((set, get) => ({
    ply: init.ply,
    flipped: init.flipped ?? false,
    tab: init.tab ?? "coach",
    mode: inMoment ? "moment" : "moves",
    momentIndex: init.momentIndex ?? 0,
    ...MOMENT_RESET,
    ...(inMoment ? init.phase : undefined),
    results: {},
    attempts: {},
    walkStartedAt: null,
    writing: init.writing ?? false,
    pending: [],
    setPly: (ply) => set({ ply }),
    setTab: (tab) => set({ tab }),
    flip: () => set({ flipped: !get().flipped }),
    setWriting: (writing) => set({ writing }),
    enterMoment: (index) => set({ mode: "moment", momentIndex: Math.max(0, index), ...MOMENT_RESET }),
    leaveMoments: () => set({ mode: "moves", ...MOMENT_RESET }),
    setPhase: (phase, patch = {}) => set({ phase, ...patch }),
    settleMoment: (result, attempts) => {
      const { momentIndex, results } = get();
      if (results[momentIndex]) return;
      set({ results: { ...results, [momentIndex]: result }, attempts: { ...get().attempts, [momentIndex]: attempts } });
    },
    startWalk: (at) => {
      if (get().walkStartedAt === null) set({ walkStartedAt: at });
    },
    queueEvent: (event) => set({ pending: [...get().pending, event] }),
    drainEvents: () => {
      const out = get().pending;
      if (out.length) set({ pending: [] });
      return out;
    },
    requeueEvents: (events) => {
      if (events.length) set({ pending: [...events, ...get().pending] });
    },
  }));
}

/** Parses `?tab=`, `?ply=` and `?m=` (1-based) from the page's search params. */
export function viewFromSearch(params: { tab?: string | null; ply?: string | null; m?: string | null }): {
  tab: ReviewTab | null;
  ply: number | null;
  momentIndex: number | null;
} {
  const tab = params.tab === "moves" || params.tab === "coach" ? params.tab : null;
  const plyN = params.ply === null || params.ply === undefined || params.ply === "" ? NaN : Number(params.ply);
  const mN = params.m === null || params.m === undefined || params.m === "" ? NaN : Number(params.m);
  return {
    tab,
    ply: Number.isInteger(plyN) && plyN >= -1 ? plyN : null,
    momentIndex: Number.isInteger(mN) && mN >= 1 && mN <= 3 ? mN - 1 : null,
  };
}

/** The URL for the current view: `?tab` only when not the default, `?ply` while browsing, `?m` (1-based) in moments. */
export function urlFor(
  pathname: string,
  current: URLSearchParams,
  view: Pick<ReviewView, "tab" | "ply" | "mode" | "momentIndex">,
  lastPly: number,
): string {
  const q = new URLSearchParams(current);
  q.delete("tab");
  q.delete("ply");
  q.delete("m");
  if (view.mode === "moment") {
    q.set("m", String(view.momentIndex + 1));
  } else {
    if (view.tab !== "coach") q.set("tab", view.tab);
    if (view.ply !== lastPly) q.set("ply", String(view.ply));
  }
  const qs = q.toString();
  return `${pathname}${qs ? `?${qs}` : ""}`;
}
