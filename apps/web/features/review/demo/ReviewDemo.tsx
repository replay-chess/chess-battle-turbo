"use client";

// /dev/ui/review (phase-03 plan §4.10, F1 "against fixtures via /dev/ui"): the real ReviewScreen on the contract
// fixtures (@repo/contracts/http/fixtures/review: the design's GAME and CLEAN, replayed), with no server. The query
// cache is seeded with the fixture; `live=1` replays `analysis:progress` frames through the same cache updater the
// socket path uses (lib/realtime/handlers/analysis.ts), then `analysis:writing` and a done payload, so the delta
// merge and the auto-advance can be watched and screenshotted.

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { GAME, reviewFixture } from "@repo/contracts/http/fixtures/review";
import type { ReviewDTO } from "@repo/contracts/http/review";
import { qk } from "@/lib/api/keys";
import { applyAnalysisEvent } from "@/lib/realtime/handlers/analysis";
import { ReviewScreen } from "../components/ReviewScreen";
import { reviewPlies } from "../model";
import { destsOf, lineOf, sanOf } from "../moments";
import type { ReviewViewInit } from "../view-store";
import type { MomentDemoPhase, ReviewDemoState } from "./states";
import { reviewDemoFixture } from "./review-fixture";

export function momentPhaseInit(dto: ReviewDTO, index: number, phase: MomentDemoPhase): ReviewViewInit["phase"] {
  const m = dto.review?.moments[index];
  if (!m) return undefined;
  const plies = reviewPlies(dto);
  const before = plies.fens[Math.min(m.ply, plies.fens.length - 1)]!;
  switch (phase) {
    case "ask":
      return { phase: "ask" };
    case "tried": {
      const wrong = [...destsOf(before).entries()]
        .flatMap(([from, tos]) => tos.map((to) => `${from}${to}`))
        .find((u) => !m.accept.includes(u) && u !== m.playedUci);
      return wrong ? { phase: "tried", tried: wrong, triedSan: sanOf(before, wrong), wrong: 1 } : { phase: "ask" };
    }
    case "pickLine":
      return { phase: "pickLine", planChip: m.intent === "trade" ? "attack" : "trade" };
    case "found":
      return { phase: "found", accepted: m.bestUci, acceptedAs: "best" };
    case "found_retry":
      return { phase: "found_retry", accepted: m.bestUci, acceptedAs: "best", wrong: 1 };
    case "reveal":
      return { phase: "reveal" };
    case "line":
      return { phase: "line", lineN: lineOf(before, m.line).length };
  }
}

export interface ReviewDemoProps {
  state: ReviewDemoState;
  live: boolean;
  share: boolean;
  flip: boolean;
  /** The 1-based moment (`?m=`; `state=moment` defaults to 1) and its sub-state. */
  moment?: number | null;
  phase?: MomentDemoPhase;
  stress?: boolean;
  /** The viewer's colour for the stress game ("both colours", testing X9). */
  side?: "w" | "b";
  /** P5 (`?bank=1`): A1 with the `train` bank fields (every moment in the bank, a card due tomorrow): the toggle shows. */
  bank?: boolean;
}

export function ReviewDemo({ state, live, share, flip, moment = null, phase = "ask", stress = false, side = "w", bank = false }: ReviewDemoProps) {
  const qc = useQueryClient();
  const [seeded] = useState(() => {
    const base = reviewDemoFixture(live ? "queued" : state, stress, side);
    const dto =
      bank && base.review
        ? {
            ...base,
            review: {
              ...base.review,
              moments: base.review.moments.map((mo, i) => ({ ...mo, inBank: true, card: { ref: `m_Demo${i + 1}`, dueLabel: "tomorrow" } })),
            },
          }
        : base;
    qc.setQueryData(qk.review.detail(dto.ref), dto);
    return dto;
  });
  const momentCount = seeded.review?.moments.length ?? 0;
  const wanted = moment ?? (state === "moment" ? 1 : null);
  const momentIndex = wanted !== null && momentCount > 0 && seeded.status === "done" ? Math.min(Math.max(1, wanted), momentCount) - 1 : null;
  const ref = seeded.ref;

  // live=1: queued → progress frames every 2 plies → writing → done (the worker's cadence, 300 ms).
  useEffect(() => {
    if (!live) return;
    const total = GAME.plies;
    const best = GAME.best.split(" ");
    let graded = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(
      setTimeout(function step() {
        const from = graded;
        graded = Math.min(total, graded + 2);
        applyAnalysisEvent(qc, ref, "analysis:progress", {
          v: 1,
          gameRef: ref,
          from,
          gradedPlies: graded,
          totalPlies: total,
          evals: GAME.evals.slice(from, graded + 1),
          best: best.slice(from, graded).join(" "),
          j: GAME.j.slice(from, graded),
          depthP50: 18,
        });
        if (graded < total) timers.push(setTimeout(step, 300));
        else
          timers.push(
            setTimeout(() => {
              qc.setQueryData(qk.review.detail(ref), reviewFixture("done"));
            }, 1_200),
          );
      }, 800),
    );
    return () => timers.forEach(clearTimeout);
  }, [live, qc, ref]);

  return (
    <ReviewScreen
      refId={ref}
      flags={{ share }}
      demo
      initialTab={state === "moves" ? "moves" : null}
      initialMoment={momentIndex}
      initialMomentPhase={momentIndex === null ? undefined : momentPhaseInit(seeded, momentIndex, phase)}
      initialWriting={state === "writing"}
      initialFlipped={flip}
    />
  );
}
