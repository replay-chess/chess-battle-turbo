import { useSyncExternalStore } from "react";

// "Is an app shell mounted?" store (SPEC 3.6). The toaster reads it to pick the
// shell placement (D16). A counter, so nested or overlapping shells balance.

let mounted = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Increments the count; the returned cleanup decrements it (once). */
export function markShellMounted(): () => void {
  mounted += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mounted -= 1;
    emit();
  };
}

/** Pure snapshot, unit-testable. */
export function isShellPresent(): boolean {
  return mounted > 0;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server snapshot is false. */
export function useShellPresent(): boolean {
  return useSyncExternalStore(subscribe, isShellPresent, () => false);
}
