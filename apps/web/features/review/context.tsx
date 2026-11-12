"use client";

// The review screen's context: the payload (from the query cache), the replayed plies, the per-instance view store,
// the narration controller and the screen actions. Components read the view store through `useView(selector)`.

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { ReviewDTO } from "@repo/contracts/http/review";
import type { Plies, ReviewPhase } from "./model";
import type { Narrator } from "./narration";
import type { ReviewView, ReviewViewActions, ReviewViewStore } from "./view-store";

export interface ReviewActions {
  /** A4 (optimistic queued); a no-op while one is in flight. */
  retry(): void;
  retrying: boolean;
  /** Start Review: the first key moment. */
  startReview(): void;
  /** Download PGN (built in the browser, P3-D18). */
  downloadPgn(): void;
  /** A client refetch failed: the inline "Couldn't refresh" banner and its Try Again. */
  refreshFailed: boolean;
  refetch(): void;
}

export interface ReviewFlags {
  /** review-share: the menu item and the S key. */
  share: boolean;
}

export interface ReviewContextValue {
  refId: string;
  dto: ReviewDTO;
  plies: Plies;
  phase: ReviewPhase;
  store: ReviewViewStore;
  narrator: Narrator | null;
  actions: ReviewActions;
  flags: ReviewFlags;
  /** /dev/ui demo: no network, no realtime, links stay on the demo. */
  demo: boolean;
  /** The ply the board shows when nothing is selected (the last one). */
  lastPly: number;
}

const ReviewContext = createContext<ReviewContextValue | null>(null);

export const ReviewProvider = ReviewContext.Provider;

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error("useReview() outside ReviewScreen");
  return ctx;
}

export function useView<T>(selector: (v: ReviewView & ReviewViewActions) => T): T {
  return useStore(useReview().store, selector);
}
