"use client";

// The current item and what it shows. Selects stable store slices (zustand needs stable snapshots) and derives the
// view in render: `viewOf` is a few object literals, cheaper than any memo bookkeeping.
import { useStore } from "zustand";
import type { TrainItem } from "@repo/contracts/http/train";
import { viewOf, type RunView } from "@/features/train/machine";
import type { RunnerStore } from "@/features/train/runner-store";
import type { PreparedItem } from "@/features/train/validate";
import { useRunnerContext } from "./context";

export type Current = { item: TrainItem; prepared: PreparedItem; view: RunView; index: number; total: number } | null;

/** The current item of a store (the root uses it before the provider exists). */
export function useCurrentOf(store: RunnerStore): Current {
  const items = useStore(store, (s) => s.items);
  const index = useStore(store, (s) => s.index);
  const run = useStore(store, (s) => s.run);
  const prepared = useStore(store, (s) => s.prepared);
  const item = items[index];
  const p = item ? prepared[item.itemId] : null;
  if (!item || !p || !run) return null;
  return { item, prepared: p, view: viewOf(item, p, run), index, total: items.length };
}

/** The current item, or once the session is done the last one, frozen (no input): the board never goes blank. */
export function useShownOf(store: RunnerStore): Current {
  const cur = useCurrentOf(store);
  const items = useStore(store, (s) => s.items);
  const prepared = useStore(store, (s) => s.prepared);
  const last = useStore(store, (s) => s.last);
  if (cur) return cur;
  if (!last) return null;
  const i = items.findIndex((it) => it.itemId === last.itemId);
  const item = items[i];
  const p = item ? prepared[item.itemId] : null;
  if (!item || !p) return null;
  return { item, prepared: p, view: { ...viewOf(item, p, last.run), mover: null }, index: i, total: items.length };
}

export function useCurrent(): Current {
  return useCurrentOf(useRunnerContext().store);
}
