"use client";

// The runner's context: the per-instance store and the actions the panel, the bars and the control bar call. One
// TrainerRunner provides it; every child reads the store with `useRunner(selector)` (zustand, no prop drilling).
import { createContext, useContext } from "react";
import type { BoardMove } from "@/components/board/types";
import type { GradeKey } from "@repo/chess-training/grade";
import type { ReportBody } from "@repo/contracts/http/reports";
import { useStore } from "zustand";
import type { RunnerState, RunnerStore } from "@/features/train/runner-store";

/** The report reasons (`@repo/contracts/http/reports`, the one source; type-only). */
export type ReportReason = ReportBody["reason"];

export type RunnerUi = {
  /** Which ⋯ menu is open: the panel's or the phone control bar's (both exist; CSS shows one). */
  menuOpen: "panel" | "phone" | null;
  themesOpen: boolean;
  reportOpen: boolean;
  /** Attempts of this session still in the outbox (the done block's "Saving your results…"). */
  pending: number;
  /** The summary navigation is waiting for the flush (≤ 3 s). */
  leaving: boolean;
};

export type RunnerActions = {
  move(m: BoardMove): void;
  hint(): boolean;
  retry(): boolean;
  showSolution(): boolean;
  grade(g: GradeKey): void;
  skip(): void;
  endSession(): void;
  seeSummary(): void;
  startAgain(): void;
  report(reason: ReportReason, note: string): Promise<void>;
  pickTheme(key: string): void;
  setMenu(open: "panel" | "phone" | null): void;
  setThemes(open: boolean): void;
  setReport(open: boolean): void;
};

export type RunnerContextValue = {
  store: RunnerStore;
  actions: RunnerActions;
  ui: RunnerUi;
  /** Bank links (Bank chip, See It in Your Game) and the summary are real routes; the demo keeps them on /dev. */
  demo: boolean;
  /** Where Back goes (the hub). */
  backHref: string;
};

const RunnerContext = createContext<RunnerContextValue | null>(null);

export const RunnerProvider = RunnerContext.Provider;

export function useRunnerContext(): RunnerContextValue {
  const v = useContext(RunnerContext);
  if (!v) throw new Error("useRunnerContext outside TrainerRunner");
  return v;
}

export function useRunner<T>(selector: (s: RunnerState) => T): T {
  const { store } = useRunnerContext();
  return useStore(store, selector);
}
