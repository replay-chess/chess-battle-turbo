"use client";

// One player's clock (P2 plan 4.4): subscribes to the clock store only, so a running clock re-renders this chip
// and nothing else. Running chip: ink, amber ≤ 60 s, red ≤ 20 s, tenths under 10 s; idle at zero: red digits.

import { useSyncExternalStore } from "react";
import type { Side } from "@repo/game-core/machine/types";
import { useController } from "../screen/GameContext";
import { clockSourceFor } from "./clockStore";

export function ClockChip({ side, name }: { side: Side; name: string }) {
  const source = clockSourceFor(useController());
  const view = useSyncExternalStore(
    (l) => source.subscribe(side, l),
    () => source.get(side),
    () => source.initial(side),
  );
  return (
    <span
      className="g-clk"
      role="timer"
      aria-live="off"
      aria-label={`${name} clock ${view.text}${view.running ? ", running" : ""}`}
      data-testid={`clock-${side}`}
      data-running={view.running ? "" : undefined}
      data-idle={view.idle ? "" : undefined}
      data-tone={view.tone}
      data-low={view.low ? "" : undefined}
    >
      {view.text}
    </span>
  );
}
