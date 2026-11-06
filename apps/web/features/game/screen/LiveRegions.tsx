"use client";

// The two screen-reader live regions of the game (P2 plan 4.4): polite for moves and the connection, assertive for
// a move that checks the viewer, ten seconds left, the opponent disconnecting and game over. Text comes from the
// pure `announce()` (features/game/announce.ts) on every store change. Both regions are always in the DOM (a live
// region added together with its text is often not read); a repeated message alternates a trailing no-break space
// so it is announced again.

import { useEffect, useState } from "react";
import { announce, LOW_TIME_ANNOUNCEMENT } from "../announce";
import { useLowTimeAlert } from "../clock/useLowTimeAlert";
import { useController } from "./GameContext";

const NBSP = " ";
const bump = (prev: string, text: string) => (prev === text ? `${text}${NBSP}` : text);

export function LiveRegions() {
  const controller = useController();
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(
    () =>
      controller.store.subscribe((next, prev) => {
        const a = announce(prev, next, controller.serverNow());
        if (a.polite) setPolite((p) => bump(p, a.polite!));
        if (a.assertive) setAssertive((p) => bump(p, a.assertive!));
      }),
    [controller],
  );

  useLowTimeAlert(() => setAssertive((p) => bump(p, LOW_TIME_ANNOUNCEMENT)));

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="game-live-polite">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="game-live-assertive">
        {assertive}
      </div>
    </>
  );
}
