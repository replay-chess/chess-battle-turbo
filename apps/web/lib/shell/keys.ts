// Keyboard rules for the shell (SPEC 8.2 "Keys", D20). Pure: no DOM globals,
// so every rule is unit-tested. useShellKeys wires them to one window listener.

// The editable-target check, the open-modal selector and the key shape live in ./key-target.ts, so screen hotkeys
// (the game, the review) can use them without pulling this module's shortcut tables into their first load.
import { isEditableTarget, MODAL_OPEN_SELECTOR, type KeyLike } from "./key-target";

export { isEditableTarget, MODAL_OPEN_SELECTOR, type KeyLike };

export type NavigatorLike = {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
};

export function isApplePlatform(nav: NavigatorLike | undefined): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Marks the shell's own palette and shortcuts dialogs, so they don't count as "a modal is open". */
export const SHELL_DIALOG_ATTR = "data-rc-shell-dialog";

export type KeyContext = {
  /** (hover: none) and (pointer: coarse) */
  coarse: boolean;
  singleKeyEnabled: boolean;
  /** A modal that is not one of the shell's own dialogs is open. */
  modalOpen: boolean;
  /** The palette or the shortcuts dialog is open. */
  shellDialogOpen: boolean;
  editable: boolean;
};

export type KeyAction = "palette" | "slash" | "help" | "chord-key" | "ignore";

export function classifyKeydown(e: KeyLike, ctx: KeyContext): KeyAction {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.key === "Process") return "ignore";
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  const ctrl = e.ctrlKey && !altGraph;
  const alt = e.altKey && !altGraph;

  const isK = e.code === "KeyK" || e.key === "k" || e.key === "K";
  if (isK && (e.metaKey || ctrl)) {
    // ⌘K works everywhere: in fields, on touch, over the shell's own dialogs.
    if (ctx.modalOpen && !ctx.shellDialogOpen) return "ignore";
    return "palette";
  }

  // Single keys: fine pointers, switch on, outside fields, no modal (WCAG 2.1.4).
  if (ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen || ctx.shellDialogOpen) return "ignore";
  if (e.metaKey || ctrl || alt) return "ignore";
  if (e.key === "/") return "slash";
  if (e.key === "?") return "help";
  return "chord-key";
}

export type ChordMachine = {
  press: (code: string, key: string, now: number) => { navigate?: string; armed?: boolean };
};

/** "п" on a Russian layout still has code KeyP; letters without a code fall back to the key. */
function codeFor(code: string, key: string): string {
  if (code) return code;
  return /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : "";
}

export function createChordMachine({
  timeoutMs,
  chords,
}: {
  timeoutMs: number;
  chords: Record<string, string>;
}): ChordMachine {
  let armedAt: number | null = null;
  return {
    press(code, key, now) {
      const wasArmed = armedAt !== null && now - armedAt <= timeoutMs;
      armedAt = null;
      if (wasArmed) {
        const target =
          chords[codeFor(code, key)] ?? (/^[a-z]$/i.test(key) ? chords[`Key${key.toUpperCase()}`] : undefined);
        return target ? { navigate: target } : {};
      }
      if (code === "KeyG" || key === "g") {
        armedAt = now;
        return { armed: true };
      }
      return {};
    },
  };
}

/** The Phase 1 chords: G then P, G then L. */
export const SHELL_CHORDS: Record<string, string> = { KeyP: "/play", KeyL: "/legends" };
export const CHORD_TIMEOUT_MS = 1000;

/** The chords for this viewer: P3 adds G then R (Review → My Games) with `review-v3`. */
export function shellChords(flags: { reviewV3?: boolean } = {}): Record<string, string> {
  return flags.reviewV3 ? { ...SHELL_CHORDS, KeyR: "/games" } : SHELL_CHORDS;
}
