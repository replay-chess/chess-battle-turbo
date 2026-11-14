"use client";

// /dev/ui/game-over (phase-03 plan §4.10): P2's real game screen in a game-over state with P3's result-card slots
// (features/review/game-over, WP-E) on, fed with no server: the review status is seeded into `qk.review.status(ref)`
// from the contract fixtures, and `review-v3` is turned on through a demo viewer in `qk.me()` (useFlag reads it).
//   analysing → the disabled "Analysing · nn%" primary and the progress line; queued; done / clean → the accuracy
//   eyebrow, the coach line and See What the Coach Thinks; failed / terminal → Open Review; skipped → no slots;
//   legend* → the `over_legend` block (diverged, followed, the opponent left the line, evals pending).
// The legend block is passed straight into the `legend` slot: P2's demo fixtures are standard games, and the live slot
// renders only for a game played from a legend position.

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { legendSummaryFixture, reviewStatusFixture, type ReviewStatusFixtureState } from "@repo/contracts/http/fixtures/review";
import type { MeData } from "@repo/contracts/http/me";
import type { LegendSummaryDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import type { DesignState } from "@repo/game-core/client/viewState";
import { createDemoController } from "@/features/game/demo/controller";
import { GameView } from "@/features/game/screen/GameView";
import { LegendBlock } from "@/features/review/game-over/GameOverReview";
import { REVIEW_RESULT_SLOTS } from "@/features/review/game-over/lazy";
import { withBankSlot } from "@/components/train/slots/GameOverBankSlotLazy";
import { qk } from "@/lib/api/keys";
import { gameOverDemoFixture } from "./game-over-fixture";
import { MORPHY_OPPONENT_LEFT } from "./game-over-games";
import { fitStatusToGame, type GameOverDemoSlot } from "./states";

const STATUS: Record<GameOverDemoSlot, ReviewStatusFixtureState> = {
  analysing: "running",
  queued: "queued",
  done: "done",
  clean: "clean",
  failed: "failed",
  terminal: "terminal",
  skipped: "skipped",
  legend: "done",
  legend_followed: "done",
  legend_opponent: "done",
  legend_pending: "running",
};

const LEGEND: Partial<Record<GameOverDemoSlot, LegendSummaryDTO>> = {
  legend: legendSummaryFixture("diverged"),
  legend_followed: legendSummaryFixture("followed"),
  legend_opponent: MORPHY_OPPONENT_LEFT,
  legend_pending: legendSummaryFixture("facts_ready"),
};

/** A demo viewer: a member with the P3 flags on (only `flags` is read on this screen). */
function demoMe(): MeData {
  return {
    user: {
      ref: "cdemouser00000000000000001",
      code: "demo",
      name: "knightowl_88",
      email: "demo@example.invalid",
      avatarUrl: null,
      role: "user",
      onboarded: true,
      ratingLabel: "Rapid 1184",
    },
    entitlement: {
      state: "member",
      member: true,
      entitled: true,
      paywall: true,
      planKey: "monthly",
      interval: "month",
      priceCents: 999,
      status: "active",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trial: { active: false, used: true, endsAt: null, daysLeft: null, eligible: false },
      paymentIssue: null,
      hasBillingPortal: true,
    },
    flags: { "review-v3": true, "review-share": true },
    buildId: "dev",
  };
}

/** P5 (`?bank=0|1|2`): A2's `bank` for the game-over Mistake Bank line (V3GameOver `r.bank`); null = `train` off. */
const BANK_DEMO: Record<number, ReviewStatusDTO["bank"]> = {
  0: { count: 0, plies: [] },
  1: { count: 1, plies: [24] },
  2: { count: 2, plies: [24, 36] },
};

export function GameOverDemo({ slot, state, bank = null }: { slot: GameOverDemoSlot; state: DesignState; bank?: number | null }) {
  const qc = useQueryClient();
  const [{ controller }] = useState(() => {
    const fixture = gameOverDemoFixture(slot, state);
    const ref = fixture.game.state.ref;
    const moves = fixture.game.state.moves.trim();
    const plies = moves === "" ? 0 : moves.split(/\s+/).length;
    const status: ReviewStatusDTO = fitStatusToGame(
      slot,
      { ...reviewStatusFixture(STATUS[slot]), comparison: LEGEND[slot] ?? null },
      plies,
    );
    qc.setQueryData(qk.me(), demoMe());
    qc.setQueryData(qk.review.status(ref), bank === null ? status : { ...status, bank: BANK_DEMO[bank] ?? null });
    return { controller: createDemoController(fixture, { freeze: true, toasts: "hold" }) };
  });
  const legend = LEGEND[slot];
  return (
    <div style={{ display: "contents" }} data-testid="game-over-demo" data-slot={slot}>
      <GameView
        controller={controller}
        resultSlots={withBankSlot(legend ? { ...REVIEW_RESULT_SLOTS, legend: <LegendBlock c={legend} /> } : REVIEW_RESULT_SLOTS, bank !== null)}
      />
    </div>
  );
}
