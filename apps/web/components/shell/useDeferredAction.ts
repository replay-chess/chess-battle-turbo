"use client";

import { useRef } from "react";

/**
 * Runs an action only after a menu, sheet or dialog has fully closed (C H9).
 * Opening a modal from inside a closing Radix layer otherwise leaves focus on the
 * stale trigger and `body` with `pointer-events: none`.
 *
 * - Items call `defer(fn)` in their select handler; the layer then closes.
 * - The layer's content gets `onCloseAutoFocus={onCloseAutoFocus}`. When an action
 *   is pending, it prevents the focus restore and runs the action on the next task,
 *   after Radix has removed its pointer-events lock.
 */
export function useDeferredAction() {
  const pending = useRef<(() => void) | null>(null);

  function defer(fn: () => void) {
    pending.current = fn;
  }

  function onCloseAutoFocus(event: Event) {
    const fn = pending.current;
    if (!fn) return;
    pending.current = null;
    event.preventDefault();
    window.setTimeout(fn, 0);
  }

  return { defer, onCloseAutoFocus };
}
