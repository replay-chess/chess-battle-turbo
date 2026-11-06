"use client";

// The live controller hook (P2 plan 5.2.1, 5.2.6): creates one LiveController per game instance and binds it to
// the tab's socket while mounted. After the game ends here: prefetch the analysis page and mark game lists stale
// without refetching (plan 5.2.9).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import type { GameState } from "@repo/game-core/machine/types";
import { createLiveController, type JoinFailure, type LiveController } from "./useGameSocket";

export function useLiveGame(snapshot: GameState, onJoinFailure: (code: JoinFailure) => void): LiveController {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [controller] = useState(() =>
    createLiveController(snapshot, {
      navigate: (to) => router.replace(to),
      refresh: () => router.refresh(),
      onJoinFailure,
      onEnded: (ref) => {
        router.prefetch(`/analysis/${ref}`);
        void queryClient.invalidateQueries({ queryKey: qk.games.all(), refetchType: "none" });
      },
    }),
  );

  useEffect(() => controller.attach(), [controller]);

  return controller;
}
