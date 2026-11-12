// The smallest keyboard helpers every screen shares (SPEC 8.2 "Keys", D20): is the event target editable, is a modal
// open, and the shape of a key event. Pure and dependency-free, so the game and review screens can import them
// without the shell's shortcut tables (lib/shell/keys.ts re-exports them for the shell).

/** Anything that looks like an Element for the editable check. */
type ElementLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** input, textarea, select, contenteditable, or inside [role=combobox]. */
export function isEditableTarget(el: unknown): boolean {
  if (!el || typeof el !== "object") return false;
  const node = el as ElementLike;
  if (node.tagName && EDITABLE_TAGS.has(node.tagName.toUpperCase())) return true;
  if (node.isContentEditable) return true;
  if (typeof node.closest === "function") {
    return Boolean(node.closest('[contenteditable=""], [contenteditable="true"], [role="combobox"]'));
  }
  return false;
}

/** A modal of any kind is open: Radix dialogs, legacy modals, Clerk, the iOS install modal. */
export const MODAL_OPEN_SELECTOR =
  '[aria-modal="true"], [role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), .cl-modalBackdrop, [data-rc-modal]';

export type KeyLike = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
  getModifierState?: (key: string) => boolean;
};
