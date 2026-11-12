"use client";

// A page's own phone Back target (lib/nav/destinations.ts backTarget answers from the path alone). Practice knows
// where it was opened from (a review, a comparison, a position: PracticeContextDTO.backHref), the shell's top bar does
// not, so the page mounts <ShellBackOverride> and the shell (AppShellView) shows that target while it is mounted
// (FIX-2). One override at a time: the latest mount wins, an unmount restores the path's own target.
import { useEffect, useSyncExternalStore } from "react";
import type { BackTarget } from "@/lib/nav/destinations";

let current: BackTarget | null = null;
const listeners = new Set<() => void>();

function set(next: BackTarget | null): void {
  current = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The page's Back target, or null (the server and the first client render have none). */
export function useBackOverride(): BackTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Mount in a page: the shell's Back goes to `target` while the page is on screen. */
export function ShellBackOverride({ target }: { target: BackTarget }) {
  const { key, href, label } = target;
  useEffect(() => {
    const mine: BackTarget = { key, href, label };
    set(mine);
    return () => {
      if (current === mine) set(null);
    };
  }, [key, href, label]);
  return null;
}
