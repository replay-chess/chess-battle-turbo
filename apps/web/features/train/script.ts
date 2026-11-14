// Demo scripts for the /dev/ui runner routes (phase-05 plan §2.1 "Dev demo routes"): the user actions that reach a
// board state from the first item (`app/dev/ui/_fixtures/train.ts` RunnerDemo.script), applied to a fresh store before
// the first paint, with every timer-driven step (setup, replies, solution plies) run at once. Pure; no React.
import type { GradeKey } from "@repo/chess-training/grade";
import { timerFor } from "./machine";
import type { RunnerStore } from "./runner-store";

export type DemoStep =
  | { type: "hint" }
  | { type: "move"; uci: string }
  | { type: "solution" }
  | { type: "themes" }
  | { type: "grade"; grade: GradeKey };

/** Runs every timer-driven step at once (demo scripts reach a board state synchronously). */
function settle(store: RunnerStore): void {
  for (let i = 0; i < 40; i++) {
    const run = store.getState().run;
    if (!run) return;
    const t = timerFor(run);
    if (!t) return;
    store.getState().dispatch(t.event);
  }
}

/** Applies a demo script to a fresh store (the user's actions from the first item). */
export function applyScript(store: RunnerStore, script: readonly DemoStep[]): { themes: boolean } {
  let themes = false;
  const run0 = store.getState().run;
  if (script.length && run0?.phase === "setup") store.getState().dispatch({ type: "setup_done" });
  for (const st of script) {
    const s = store.getState();
    if (st.type === "hint") s.dispatch({ type: "hint" });
    else if (st.type === "move") {
      if (s.run?.phase === "setup") s.dispatch({ type: "setup_done" });
      store.getState().dispatch({ type: "move", uci: st.uci });
      const after = store.getState().run;
      if (after?.phase === "reply") settle(store);
    } else if (st.type === "solution") {
      s.dispatch({ type: "show_solution" });
      settle(store);
    } else if (st.type === "themes") themes = true;
    else if (st.type === "grade") {
      s.grade(st.grade);
      if (store.getState().run?.phase === "setup") store.getState().dispatch({ type: "setup_done" });
    }
  }
  return { themes };
}

