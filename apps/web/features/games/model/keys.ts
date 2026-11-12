// Keyboard model of the /games listbox (phase-03 plan §4.9 "Interactions"). Pure; the screen maps a keydown to one of
// these actions and applies it.
//
//   ↑ / ↓ / Home / End / PageUp / PageDown   move the selection (aria-activedescendant)
//   Enter                                     open the selected review
//   C                                         open Compare (legend games only)
//   F                                         focus the search field ("/" stays the P1 command palette)

export type ListAction =
  | { type: "move"; index: number }
  | { type: "open"; target: "review" | "compare" }
  | { type: "search" }
  | null;

/** Rows per PageUp/PageDown (a 56 px row in a ~450 px list). */
export const PAGE_STEP = 8;

type KeyLike = { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

/** The new index for a navigation key, or null when the key does not move (or there are no rows). */
export function moveIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = current < 0 ? -1 : Math.min(current, last);
  switch (key) {
    case "ArrowDown":
      return from < 0 ? 0 : Math.min(from + 1, last);
    case "ArrowUp":
      return from < 0 ? 0 : Math.max(from - 1, 0);
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return from < 0 ? 0 : Math.min(from + PAGE_STEP, last);
    case "PageUp":
      return from < 0 ? 0 : Math.max(from - PAGE_STEP, 0);
    default:
      return null;
  }
}

/**
 * The action for a keydown on the listbox. Modified keys are left to the browser and the shell (⌘K, chords), except
 * that Shift never matters for the letter keys.
 */
export function listKeyAction(e: KeyLike, current: number, count: number, canCompare: boolean): ListAction {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const index = moveIndex(current, e.key, count);
  if (index !== null) return { type: "move", index };
  if (e.key === "Enter") return current >= 0 && current < count ? { type: "open", target: "review" } : null;
  const letter = e.key.length === 1 ? e.key.toLowerCase() : "";
  if (letter === "c") return canCompare && current >= 0 ? { type: "open", target: "compare" } : null;
  if (letter === "f") return { type: "search" };
  return null;
}

/** `F` anywhere on the page (outside text fields and dialogs) focuses the search field. */
export function isSearchShortcut(e: KeyLike & { target: EventTarget | null }): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  if (e.key.toLowerCase() !== "f") return false;
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.closest !== "function") return true;
  if (t.isContentEditable) return false;
  if (t.closest("input, textarea, select, [role='dialog'], [role='listbox']")) return false;
  return true;
}
