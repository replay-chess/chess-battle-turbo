"use client";

// Focus return for the game screen's overlays (focusRestore.ts, loaded in its own chunk: the /game route is at its
// first-load budget, plan 9.1). FIX-A: closing the resign confirm, the promotion picker, the offer bars or the Watch
// Another Game sheet left focus on <body>.

import { useEffect } from "react";

export function useFocusRestore(): void {
  useEffect(() => {
    let off: (() => void) | null = null;
    let gone = false;
    import("./focusRestore").then(
      (m) => {
        if (!gone) off = m.installFocusRestore();
      },
      () => undefined,
    );
    return () => {
      gone = true;
      off?.();
    };
  }, []);
}
