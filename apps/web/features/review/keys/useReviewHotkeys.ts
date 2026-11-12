"use client";

// The review's keyboard shortcuts (plan §4.1; rows in the shortcuts dialog's "In a Review" section,
// lib/shell/keys.ts): one window listener while the screen is mounted. It reads the view store at key time, so it
// never holds stale state. ⌘K, ?, / and the g-chords stay with the shell; Radix menus own their own keys.
// Moment keys (1–5 plan chips, L Show Line) are handled by the key-moment walkthrough (F4) through `onMomentKey`;
// S opens Share (F6) when `review-share` is on.

import { useEffect, useRef } from "react";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";
import type { ReviewViewStore } from "../view-store";
import { CONTROL_SELECTOR, REVIEW_ARROW_WIDGET_SELECTOR, reviewHotkeyFor, type ReviewHotkey } from "./hotkeys";

export interface ReviewHotkeyHandlers {
  store: ReviewViewStore;
  lastPly: number;
  /** Moments in the payload (Shift+arrows, Start). */
  moments: number;
  narration(): void;
  primary(): void;
  tab(tab: "coach" | "moves"): boolean;
  done(): boolean;
  share(): boolean;
  /** Keys that belong to the moment walkthrough (chips, Show Line); false when unhandled. */
  onMomentKey?(key: ReviewHotkey): boolean;
}

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

export function useReviewHotkeys(handlers: ReviewHotkeyHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const run = (key: ReviewHotkey): boolean => {
      const h = ref.current;
      const v = h.store.getState();
      const inMoment = v.mode === "moment";
      switch (key) {
        case "prev":
          if (inMoment || v.ply <= -1) return false;
          v.setPly(v.ply - 1);
          return true;
        case "next":
          if (inMoment || v.ply >= h.lastPly) return false;
          v.setPly(v.ply + 1);
          return true;
        case "first":
          if (inMoment || v.ply <= -1) return false;
          v.setPly(-1);
          return true;
        case "last":
          if (inMoment || v.ply >= h.lastPly) return false;
          v.setPly(h.lastPly);
          return true;
        case "flip":
          v.flip();
          return true;
        case "narration":
          h.narration();
          return true;
        case "primary":
          h.primary();
          return true;
        case "tab-moves":
          return !inMoment && h.tab("moves");
        case "tab-coach":
          return !inMoment && h.tab("coach");
        case "prev-moment":
          if (!inMoment) return false;
          if (v.momentIndex > 0) v.enterMoment(v.momentIndex - 1);
          else v.leaveMoments();
          return true;
        case "next-moment":
          if (!inMoment || v.momentIndex >= h.moments - 1) return false;
          v.enterMoment(v.momentIndex + 1);
          return true;
        case "done":
          return h.done();
        case "share":
          return h.share();
        default:
          return inMoment ? (h.onMomentKey?.(key) ?? false) : false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (closest(e.target, '[role="menu"], [role="menubar"]')) return;
      const key = reviewHotkeyFor(e, {
        coarse: window.matchMedia(COARSE_MQ).matches,
        singleKeyEnabled: singleKeyEnabledNow(),
        editable: isEditableTarget(e.target),
        modalOpen: document.querySelector(MODAL_OPEN_SELECTOR) !== null,
        arrowWidget: closest(e.target, REVIEW_ARROW_WIDGET_SELECTOR),
        onControl: closest(e.target, CONTROL_SELECTOR),
      });
      if (key && run(key)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
