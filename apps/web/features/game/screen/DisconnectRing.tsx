"use client";

// The grace ring on a disconnected opponent's chip (plan 4.3 #26, owner Q4): an SVG ring plus a text countdown
// ("0:30"); under reduced motion only the text counts down.

import { GRACE_MS } from "@repo/game-core/constants";
import { useCountdown } from "../clock/useCountdown";
import { useController, useGame } from "./GameContext";
import { Ring } from "./Ring";

export function DisconnectRing({ name, graceEndsAt }: { name: string; graceEndsAt: number }) {
  const controller = useController();
  const snapNow = useGame((g) => g.state.serverNow);
  const cd = useCountdown(graceEndsAt, controller.serverNow, GRACE_MS, snapNow);
  const secs = Math.ceil(cd.ms / 1000);
  return (
    <span className="g-ringchip" role="timer" aria-label={`${name} has ${secs} seconds to reconnect`}>
      <Ring size={22} progress={cd.progress} tone="warn" />
      {cd.text}
    </span>
  );
}
