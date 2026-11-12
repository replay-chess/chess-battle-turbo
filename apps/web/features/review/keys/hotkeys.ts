// Review keys (phase-03 plan §4.1 "Interactions and keyboard shortcuts"; rows in the shortcuts dialog's "In a Review"
// section, lib/shell/keys.ts). Pure: `reviewHotkeyFor(event, ctx)` names the action a keydown means, or null;
// useReviewHotkeys wires it to one window listener. Same gates as the shell and the game page (SPEC D20, WCAG 2.1.4):
// letters, Space and Enter need a fine pointer, the Single-Key Shortcuts switch on, no field and no modal; arrows and
// Home/End work with any pointer but never inside a field, a modal or a widget that owns them (the board grid, menus,
// tabs, the graph's button group). Space and Enter are left to a focused button (it activates itself).

import type { KeyLike } from "@/lib/shell/key-target";

export type ReviewHotkey =
  | "prev"
  | "next"
  | "first"
  | "last"
  | "narration"
  | "flip"
  | "primary"
  | "tab-moves"
  | "tab-coach"
  | "prev-moment"
  | "next-moment"
  | "plan-1"
  | "plan-2"
  | "plan-3"
  | "plan-4"
  | "plan-5"
  | "show-line"
  | "share"
  | "done";

export interface ReviewKeyContext {
  /** (hover: none) and (pointer: coarse). */
  coarse: boolean;
  singleKeyEnabled: boolean;
  editable: boolean;
  modalOpen: boolean;
  /** Focus is inside a widget that handles arrows/Home/End itself. */
  arrowWidget: boolean;
  /** Focus is on a button, link or other control that Space/Enter activate. */
  onControl: boolean;
}

/** Roles whose own arrow, Home and End handling wins (the game page's list plus the graph's button group). */
export const REVIEW_ARROW_WIDGET_SELECTOR =
  '[role="grid"], [role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="tree"]';

/** Elements Space/Enter already activate. */
export const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary, input, select, textarea';

const LETTERS: Record<string, ReviewHotkey> = {
  KeyF: "flip",
  KeyM: "tab-moves",
  KeyC: "tab-coach",
  KeyL: "show-line",
  KeyS: "share",
  KeyD: "done",
  Digit1: "plan-1",
  Digit2: "plan-2",
  Digit3: "plan-3",
  Digit4: "plan-4",
  Digit5: "plan-5",
};

function codeOf(e: KeyLike): string {
  if (e.code) return e.code;
  if (/^[a-z]$/i.test(e.key)) return `Key${e.key.toUpperCase()}`;
  if (/^[1-5]$/.test(e.key)) return `Digit${e.key}`;
  return "";
}

/** A keydown as the shell sees it, plus Shift (moment navigation). */
export type ReviewKeyLike = KeyLike & { shiftKey?: boolean };

export function reviewHotkeyFor(e: ReviewKeyLike, ctx: ReviewKeyContext): ReviewHotkey | null {
  if (e.defaultPrevented || e.isComposing || e.key === "Process") return null;
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  if (e.metaKey || (e.ctrlKey && !altGraph) || (e.altKey && !altGraph)) return null;
  const shift = e.shiftKey ?? e.getModifierState?.("Shift") ?? false;

  if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
    if (ctx.editable || ctx.modalOpen || ctx.arrowWidget) return null;
    if (shift && e.key === "ArrowLeft") return "prev-moment";
    if (shift && e.key === "ArrowRight") return "next-moment";
    if (shift) return null;
    return e.key === "ArrowLeft" ? "prev" : e.key === "ArrowRight" ? "next" : e.key === "Home" ? "first" : "last";
  }

  if (e.repeat || ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen) return null;
  if (e.key === " " || e.code === "Space") return ctx.onControl ? null : "narration";
  if (e.key === "Enter") return ctx.onControl ? null : "primary";
  if (shift) return null;
  return LETTERS[codeOf(e)] ?? null;
}
