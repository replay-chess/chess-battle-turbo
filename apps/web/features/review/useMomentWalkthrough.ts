"use client";

// The key-moment walkthrough's actions (phase-03 plan §4.1 `moment.*`, §5.2 "Walkthrough progress", §10.1): one
// object shared by the stepper, the board, both footers and the keyboard. Every action reads the view store at call
// time, so a handler never holds stale state.
//
// - A try is judged locally against `moment.accept` (instant): right → found / found_retry, wrong → tried (rings).
// - A plan chip shows its precomputed feedback (§8.8); picking it again unpicks.
// - Reveal → the played move with its badge and the best move as a green arrow; Show Line steps the best line.
// - Each action queues an A5 event (`viewed` is queued by the screen when a moment opens) and sends its telemetry.
// - The first terminal result per moment wins (as A5 merges it); it is also written into the cached payload
//   (optimistic), so a remount shows the same progress.
// - Finish Review: the pending A5 events go out with `keepalive`, then A7 (keepalive), then the complete page
//   (runFinish; once per press, a second press while it runs does nothing).

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { MomentResult, PlanKey, ProgressEvent, ReviewDTO } from "@repo/contracts/http/review";
import type { BoardMove } from "@/components/board/types";
import { DEFAULT_TIMEOUT_MS } from "@/lib/api/client";
import { qk } from "@/lib/api/keys";
import { completeReviewRequest } from "@/lib/api/mutations/review";
import { useReview } from "./context";
import { isAnswered, isAsking, judgeTry, lineOf, sanOf, tallyResults } from "./moments";
import { reviewCompletePath } from "./paths";
import { trackReview } from "./telemetry";
import { flushReviewProgress, settleReviewProgress } from "./useReviewProgressSync";

/**
 * The backstop on Finish Review's wait. Each request already times out on its own (api(), DEFAULT_TIMEOUT_MS), so the
 * wait ends when the last A5 result and then A7 have settled; this only covers a request that never settles at all.
 * It must exceed both request timeouts: a tighter cap (8 s) let a slow A7 (a cold or busy server) lose the race, and
 * the complete page then read `completedAt IS NULL` and rendered a finished walkthrough as `partial`
 * (regression: finish-review-partial).
 */
export const FINISH_WAIT_MS = 2 * DEFAULT_TIMEOUT_MS + 1_000;

/** Reviews whose Finish Review is running: a second press (both bars, Enter) does not send A7 or telemetry twice. */
const finishing = new Set<string>();

export type FinishSteps = {
  /** Hands every queued A5 event to the network (keepalive). */
  flush: () => void;
  /** Resolves when every A5 request sent so far has settled. */
  settle: () => Promise<void>;
  /** A7 (keepalive). */
  complete: () => Promise<unknown>;
  /** The complete page. */
  navigate: () => void;
  waitMs?: number;
};

/**
 * Finish Review's order: the last A5 results land first, then A7, then the complete page, so the page (which reads
 * the results and `completedAt`) never renders a finished walkthrough as partial. A failed request does not trap the
 * user: the page is opened anyway. Resolves false when a Finish of the same review is already running.
 */
export async function runFinish(ref: string, steps: FinishSteps): Promise<boolean> {
  if (finishing.has(ref)) return false;
  finishing.add(ref);
  try {
    steps.flush();
    const written = steps
      .settle()
      .then(() => steps.complete())
      .then(
        () => undefined,
        () => undefined,
      );
    let backstop: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([written, new Promise<void>((r) => (backstop = setTimeout(r, steps.waitMs ?? FINISH_WAIT_MS)))]);
    clearTimeout(backstop);
    steps.navigate();
    return true;
  } finally {
    finishing.delete(ref);
  }
}

const reducedMotion = () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** The demo's complete page for a walkthrough that ends on the demo route (no network there). */
export function demoCompleteHref(dto: Pick<ReviewDTO, "review">): string {
  const review = dto.review;
  if (review?.isClean) return "/dev/ui/review/complete?state=nothing";
  if (!review || review.moments.length === 0) return "/dev/ui/review/complete?state=noMoments";
  return "/dev/ui/review/complete?state=default";
}

export interface MomentWalkthrough {
  /** Start Review: resumes at the saved moment while the walkthrough is unfinished. */
  start(): void;
  tryMove(move: Pick<BoardMove, "uci">): void;
  pickChip(chip: PlanKey): void;
  reveal(): void;
  showLine(): void;
  next(): void;
  prev(): void;
  finish(): Promise<void>;
}

export function useMomentWalkthrough(): MomentWalkthrough {
  const { dto, plies, store, refId, demo, narrator, actions } = useReview();
  const qc = useQueryClient();
  const router = useRouter();
  const moments = dto.review?.moments ?? [];

  const now = () => new Date().toISOString();
  const current = () => {
    const v = store.getState();
    const m = moments[v.momentIndex];
    return m ? { v, m } : null;
  };
  const queue = (event: Omit<ProgressEvent, "at">) => store.getState().queueEvent({ ...event, at: now() });

  /** Writes a moment's first result into the cached payload (the optimistic A5 merge). */
  const cacheResult = (ply: number, result: MomentResult, attempts: number) => {
    qc.setQueryData<ReviewDTO>(qk.review.detail(refId), (d) => {
      if (!d?.review) return d;
      return {
        ...d,
        review: {
          ...d.review,
          moments: d.review.moments.map((x) => (x.ply === ply && x.result === null ? { ...x, result, attempts: Math.min(50, attempts) } : x)),
        },
      };
    });
  };

  return {
    start() {
      actions.startReview();
    },

    tryMove(move) {
      const c = current();
      if (!c || c.v.mode !== "moment" || !isAsking(c.v.phase)) return;
      const { v, m } = c;
      const verdict = judgeTry(m, move.uci, v.wrong);
      const attemptNo = Math.min(50, v.wrong + 1);
      trackReview("moment_attempt", {
        idx: v.momentIndex,
        correct: verdict.correct,
        attempt_no: attemptNo,
        accepted_as: verdict.acceptedAs,
      });
      queue({ type: "attempt", ply: m.ply, uci: move.uci, correct: verdict.correct });
      if (verdict.correct && verdict.result) {
        narrator?.stop();
        v.settleMoment(verdict.result, attemptNo);
        cacheResult(m.ply, verdict.result, attemptNo);
        v.setPhase(verdict.result, { accepted: move.uci, acceptedAs: verdict.acceptedAs, tried: null, triedSan: null, lineN: -1 });
        return;
      }
      const before = plies.fens[Math.min(m.ply, plies.fens.length - 1)] ?? dto.game.startFen;
      v.setPhase("tried", { tried: move.uci, triedSan: sanOf(before, move.uci), wrong: v.wrong + 1 });
    },

    pickChip(chip) {
      const c = current();
      if (!c || c.v.mode !== "moment" || !isAsking(c.v.phase)) return;
      const { v, m } = c;
      if (v.planChip === chip) {
        v.setPhase(v.tried ? "tried" : "ask", { planChip: null });
        return;
      }
      trackReview("moment_plan_picked", { idx: v.momentIndex, chip, matched_intent: chip === m.intent });
      queue({ type: "plan_picked", ply: m.ply, chip });
      v.setPhase("pickLine", { planChip: chip });
    },

    reveal() {
      const c = current();
      if (!c || c.v.mode !== "moment" || isAnswered(c.v.phase)) return;
      const { v, m } = c;
      narrator?.stop();
      trackReview("moment_revealed", { idx: v.momentIndex, attempts: Math.min(50, v.wrong) });
      queue({ type: "revealed", ply: m.ply });
      v.settleMoment("revealed", v.wrong);
      cacheResult(m.ply, "revealed", v.wrong);
      v.setPhase("reveal", { lineN: -1 });
    },

    showLine() {
      const c = current();
      if (!c || c.v.mode !== "moment" || !isAnswered(c.v.phase)) return;
      const { v, m } = c;
      trackReview("moment_show_line", { idx: v.momentIndex });
      queue({ type: "show_line", ply: m.ply });
      const before = plies.fens[Math.min(m.ply, plies.fens.length - 1)] ?? dto.game.startFen;
      // Reduced motion: the line jumps to its end (no 600 ms steps).
      v.setPhase("line", { lineN: reducedMotion() ? lineOf(before, m.line).length : 0 });
    },

    next() {
      const v = store.getState();
      if (v.mode !== "moment" || v.momentIndex >= moments.length - 1) return;
      v.enterMoment(v.momentIndex + 1);
    },

    prev() {
      const v = store.getState();
      if (v.mode !== "moment") return;
      if (v.momentIndex > 0) v.enterMoment(v.momentIndex - 1);
      else v.leaveMoments();
    },

    async finish() {
      if (finishing.has(refId)) return;
      const v = store.getState();
      const tally = tallyResults(v.results, moments.length);
      trackReview("review_completed", {
        ...tally,
        duration_ms: Math.max(0, Math.min(86_400_000, v.walkStartedAt === null ? 0 : Date.now() - v.walkStartedAt)),
      });
      if (demo) {
        router.push(demoCompleteHref(dto));
        return;
      }
      // The complete page reads the moment results (A5) and `completedAt` (A7): see runFinish.
      await runFinish(refId, {
        flush: () => flushReviewProgress(refId, store, { keepalive: true }),
        settle: () => settleReviewProgress(refId),
        complete: () => completeReviewRequest(refId, { keepalive: true }),
        navigate: () => {
          void qc.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
          router.push(reviewCompletePath(refId));
        },
      });
    },
  };
}
