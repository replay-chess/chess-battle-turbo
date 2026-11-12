"use client";

// The narration state of the screen's narrator (useSyncExternalStore); "off" without the Web Speech API.
import { useSyncExternalStore } from "react";
import { useReview } from "./context";
import type { NarrationState } from "./narration";

const OFF: NarrationState = { status: "off", sentence: -1, spokenChars: 0, totalChars: 0, rate: 1 };
const noop = () => () => {};

export function useNarration(): NarrationState {
  const { narrator } = useReview();
  return useSyncExternalStore(
    narrator ? narrator.subscribe : noop,
    narrator ? narrator.getSnapshot : () => OFF,
    () => OFF,
  );
}
