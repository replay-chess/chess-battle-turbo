// Game-page keys (P2 plan 4.6.1). Pure: `gameHotkeyFor(event, ctx)` says which game action a keydown means, or
// null; useGameHotkeys wires it to one window listener. Same gates as the shell's single keys (lib/shell/keys.ts,
// SPEC D20, WCAG 2.1.4): letters need a fine pointer, the Single-Key Shortcuts switch on, no field and no modal.
// Arrow keys work with any pointer but never inside a field, a modal or a widget that owns arrows (the board grid,
// menus, listboxes). Q R B N belong to the promotion picker, which listens on its own while it is open.

import type { KeyLike } from "@/lib/shell/key-target";

export type GameHotkey = "prev" | "next" | "first" | "last" | "flip" | "sound" | "draw" | "hint" | "undo" | "escape";

export interface GameKeyContext {
  /** (hover: none) and (pointer: coarse). */
  coarse: boolean;
  singleKeyEnabled: boolean;
  editable: boolean;
  /** A dialog, sheet or the palette is open. */
  modalOpen: boolean;
  /** Focus is inside a widget that uses arrow keys itself (grid, menu, listbox, slider, tabs, radio group). */
  arrowWidget: boolean;
}

/** The roles whose own arrow-key handling wins over ←/→/↑/↓ ply stepping. */
export const ARROW_WIDGET_SELECTOR =
  '[role="grid"], [role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="tablist"], [role="radiogroup"], [role="tree"]';

const ARROWS: Record<string, GameHotkey> = {
  ArrowLeft: "prev",
  ArrowRight: "next",
  ArrowUp: "first",
  ArrowDown: "last",
};

const LETTERS: Record<string, GameHotkey> = {
  KeyF: "flip",
  KeyM: "sound",
  KeyD: "draw",
  KeyH: "hint",
  KeyU: "undo",
};

/** Letters by physical key (non-Latin layouts), falling back to the character when the code is missing. */
function letterCode(code: string, key: string): string {
  if (code) return code;
  return /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : "";
}

export function gameHotkeyFor(e: KeyLike, ctx: GameKeyContext): GameHotkey | null {
  if (e.defaultPrevented || e.isComposing || e.key === "Process") return null;
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  if (e.metaKey || (e.ctrlKey && !altGraph) || (e.altKey && !altGraph)) return null;

  if (e.key === "Escape") return ctx.modalOpen || e.repeat ? null : "escape";

  const arrow = ARROWS[e.key];
  if (arrow) {
    if (ctx.editable || ctx.modalOpen || ctx.arrowWidget) return null;
    return arrow; // holding an arrow steps through the moves
  }

  if (e.repeat || ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen) return null;
  return LETTERS[letterCode(e.code, e.key)] ?? null;
}
