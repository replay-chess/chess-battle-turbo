"use client";

// Fires once when the viewer's own running clock crosses below 10 s (P2 plan 4.3 #18 `low_time`, 4.6.2
// `tenseconds`). Re-arms after the clock is back above the threshold (an increment can lift it). Reads the clock
// store (features/game/clock/clockStore.ts), so it adds no timer of its own.

import { useEffect, useRef } from "react";
import { LOW_TIME_MS } from "@repo/game-core/constants";
import type { Side } from "@repo/game-core/machine/types";
import { LOW_TIME_REARM_MS } from "../sound/events";
import { useController, useGame } from "../screen/GameContext";
import { clockSourceFor } from "./clockStore";

export function useLowTimeAlert(onCross: () => void): void {
  const controller = useController();
  const me = useGame((g): Side | null => (g.state.you.role === "player" ? (g.state.you.color ?? null) : null));
  const cb = useRef(onCross);
  useEffect(() => {
    cb.current = onCross;
  });

  useEffect(() => {
    if (!me) return;
    const src = clockSourceFor(controller);
    let armed = !src.get(me).low; // already low on arrival (a reload at 0:07): no alert
    return src.subscribe(me, () => {
      const v = src.get(me);
      if (v.low && v.running) {
        if (armed) {
          armed = false;
          cb.current();
        }
      } else if (v.ms > LOW_TIME_MS + LOW_TIME_REARM_MS) {
        armed = true;
      }
    });
  }, [controller, me]);
}
