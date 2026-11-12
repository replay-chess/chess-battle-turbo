"use client";

// One window keydown listener for a screen's own keys (Compare, Practice), with the same context the review's keys
// use (features/review/keys/useReviewHotkeys.ts): coarse pointer, the Single-Key Shortcuts switch, an editable target,
// an open modal, a widget that owns its arrows, a focused control. The handler reads its state at key time through
// a ref, so a new callback per render never re-binds. Returning true prevents the browser default.
import { useEffect, useRef } from "react";
import { CONTROL_SELECTOR, REVIEW_ARROW_WIDGET_SELECTOR, type ReviewKeyContext } from "@/features/review/keys/hotkeys";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

export function keyContextOf(e: KeyboardEvent): ReviewKeyContext {
  return {
    coarse: window.matchMedia(COARSE_MQ).matches,
    singleKeyEnabled: singleKeyEnabledNow(),
    editable: isEditableTarget(e.target),
    modalOpen: document.querySelector(MODAL_OPEN_SELECTOR) !== null,
    arrowWidget: closest(e.target, REVIEW_ARROW_WIDGET_SELECTOR),
    onControl: closest(e.target, CONTROL_SELECTOR),
  };
}

export function useScreenKeys(handler: (e: KeyboardEvent, ctx: ReviewKeyContext) => boolean, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (ref.current(e, keyContextOf(e))) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
