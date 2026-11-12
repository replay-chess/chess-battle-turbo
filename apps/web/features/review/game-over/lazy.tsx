"use client";

// The eager side of the P3 game-over slots (phase-03 plan §4.7): one `next/dynamic` stub, so /game/[ref]'s first load
// gains only a few hundred bytes (it is at its 600 kB gz budget). Everything else (the model, the status hook, the
// realtime handlers, the components and their CSS) is in the GameOverReview chunk, fetched when a result card with
// `review-v3` on first renders a slot.
//
//   REVIEW_RESULT_SLOTS   the `accuracy`, `coach` and `legend` slots GameScreen / BotGameScreen pass to GameView;
//   ReviewPrimaryLazy     the card's primary CTA (GameOverCard swaps it in for the legacy /analysis link).

import dynamic from "next/dynamic";
import type { ResultSlots } from "@/features/game/screen/GameOverCard";
import "./lazy.css";

const ReviewPart = dynamic(() => import("./GameOverReview").then((m) => m.ReviewPart), { ssr: false });

export function ReviewPrimaryLazy() {
  return <ReviewPart part="primary" />;
}

/** Pass with `review-v3` on; each slot renders nothing where it does not apply. */
export const REVIEW_RESULT_SLOTS: ResultSlots = {
  accuracy: <ReviewPart part="accuracy" />,
  coach: <ReviewPart part="coach" />,
  legend: <ReviewPart part="legend" />,
};
