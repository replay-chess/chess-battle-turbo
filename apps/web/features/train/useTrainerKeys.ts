"use client";

// The trainer's keys (phase-05 plan §4.4 "Interactions and keys", §4.5 "Keys"; V3Shortcuts "Puzzles and lessons";
// rows registered in the `?` dialog by TRAINER_SHORTCUTS, lib/shell/shortcuts.ts):
//   H hint (twice for the arrow) · R try again · S show solution · 1–4 grade · Enter the suggested grade (Next when
//   done) · T the theme picker (puzzles) · Esc closes a menu or dialog (Radix does it).
// Same gates as the shell and the review (SPEC D20, WCAG 2.1.4): single keys need a fine pointer, the Single-Key
// Shortcuts switch on, no editable field and no modal; Enter is left to a focused control and to the board grid.
import { useEffect, useRef } from "react";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR, type KeyLike } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";

export type TrainerKey = "hint" | "retry" | "solution" | "grade-1" | "grade-2" | "grade-3" | "grade-4" | "primary" | "themes";

export type TrainerKeyContext = {
  coarse: boolean;
  singleKeyEnabled: boolean;
  editable: boolean;
  modalOpen: boolean;
  /** Focus is on a control Enter already activates, or inside the board grid (Enter moves a piece there). */
  onControl: boolean;
};

/** Elements Enter already activates, plus the board's keyboard grid. */
export const TRAINER_CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="menuitem"], [role="grid"], [role="gridcell"], summary, input, select, textarea';

const LETTERS: Record<string, TrainerKey> = {
  KeyH: "hint",
  KeyR: "retry",
  KeyS: "solution",
  KeyT: "themes",
  Digit1: "grade-1",
  Digit2: "grade-2",
  Digit3: "grade-3",
  Digit4: "grade-4",
  Numpad1: "grade-1",
  Numpad2: "grade-2",
  Numpad3: "grade-3",
  Numpad4: "grade-4",
};

function codeOf(e: KeyLike): string {
  if (e.code) return e.code;
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  if (/^[1-4]$/.test(e.key)) return `Digit${e.key}`;
  return "";
}

/** The action a keydown means on the trainer, or null. Pure (useTrainerKeys.test.ts). */
export function trainerKeyFor(e: KeyLike & { shiftKey?: boolean }, ctx: TrainerKeyContext): TrainerKey | null {
  if (e.defaultPrevented || e.isComposing || e.key === "Process" || e.repeat) return null;
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  if (e.metaKey || (e.ctrlKey && !altGraph) || (e.altKey && !altGraph) || e.shiftKey) return null;
  if (ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen) return null;
  if (e.key === "Enter") return ctx.onControl ? null : "primary";
  return LETTERS[codeOf(e)] ?? null;
}

export type TrainerKeyHandlers = Partial<Record<TrainerKey, () => boolean>>;

/** One window listener while mounted; handlers return true when they acted (then the key is consumed). */
export function useTrainerKeys(handlers: TrainerKeyHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('[role="menu"], [role="menubar"], [role="dialog"]')) return;
      const key = trainerKeyFor(e, {
        coarse: window.matchMedia(COARSE_MQ).matches,
        singleKeyEnabled: singleKeyEnabledNow(),
        editable: isEditableTarget(e.target),
        modalOpen: document.querySelector(MODAL_OPEN_SELECTOR) !== null,
        onControl: target?.closest(TRAINER_CONTROL_SELECTOR) !== null && target !== null,
      });
      if (!key) return;
      if (ref.current[key]?.()) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
