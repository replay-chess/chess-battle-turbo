"use client";

// /dev/ui/practice (phase-03 plan §4.10): the real PracticeScreen on the contract fixtures, with no server. The engine
// is the real browser engine for `default`, `offline` and `over`; `engine_loading` and `engine_failed` are forced.
import { useState } from "react";
import { PracticeScreen } from "../PracticeScreen";
import { practiceDemoContext, practiceDemoEngine, type PracticeDemoSource, type PracticeDemoState } from "./states";

export function PracticeDemo({ state, source, stress }: { state: PracticeDemoState; source: PracticeDemoSource; stress: boolean }) {
  // Stable objects: the screen's engine hook keys its effects on them.
  const [context] = useState(() => practiceDemoContext(state, source, stress));
  const [demo] = useState(() => ({ engine: practiceDemoEngine(state), offline: state === "offline" }));
  return (
    <PracticeScreen
      context={context}
      viewer={{ name: stress ? "Maximilian_Oberhaus2" : "knightowl_88", ratingLabel: "Blitz 1184" }}
      urlKey={`/dev/ui/practice?state=${state}&source=${source}`}
      from="compare"
      demo={demo}
    />
  );
}
