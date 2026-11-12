"use client";

// The live controller hook (P2 plan 5.2.1, 5.2.6): creates one LiveController per game instance and binds it to
// the tab's socket while mounted. After the game ends here: prefetch the game's review (P3; the legacy analysis page
// without review-v3) and mark game lists stale
// without refetching (plan 5.2.9).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import { useFlag } from "@/lib/flags/client";
import { reviewHref } from "@/lib/routes";
import type { GameState } from "@repo/game-core/machine/types";
import { createLiveController, type JoinFailure, type LiveController } from "./useGameSocket";

export function useLiveGame(snapshot: GameState, onJoinFailure: (code: JoinFailure) => void): LiveController {
  const router = useRouter();
  const queryClient = useQueryClient();
  // P3: with review-v3 the game's review replaces the legacy /analysis page (lib/routes.ts reviewHref).
  const reviewV3 = useFlag("review-v3");
  const reviewV3Ref = useRef(reviewV3);
  useEffect(() => {
    reviewV3Ref.current = reviewV3;
  }, [reviewV3]);
  const [controller] = useState(() =>
    createLiveController(snapshot, {
      navigate: (to) => router.replace(to),
      refresh: () => router.refresh(),
      onJoinFailure,
      onEnded: (ref) => {
        router.prefetch(reviewHref(ref, reviewV3Ref.current, { from: "game_over" }));
        void queryClient.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
      },
    }),
  );

  useEffect(() => controller.attach(), [controller]);

  return controller;
}
