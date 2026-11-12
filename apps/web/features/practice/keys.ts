// Practice's keys (phase-03 plan §4.8 "Interactions"): Backspace Take Back (the last full move pair); R Reset; H hint
// (twice for the arrow); ←/→ step through the practice line; F flip; Esc cancels a selection (the board's own key).
// Pure: `practiceKeyFor` names the action, or null. Same gates as the review's keys: letters and Backspace need a fine
// pointer, single-key shortcuts on, no field and no modal; arrows work with any pointer, never in a field, a modal or
// a widget that owns them.
import type { ReviewKeyContext, ReviewKeyLike } from "@/features/review/keys/hotkeys";
import type { ShortcutSection } from "@/lib/shell/shortcuts";

export type PracticeKey = "takeback" | "reset" | "hint" | "prev" | "next" | "flip";

const LETTERS: Record<string, PracticeKey> = { KeyR: "reset", KeyH: "hint", KeyF: "flip" };

export function practiceKeyFor(e: ReviewKeyLike, ctx: ReviewKeyContext): PracticeKey | null {
  if (e.defaultPrevented || e.isComposing || e.key === "Process") return null;
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  if (e.metaKey || (e.ctrlKey && !altGraph) || (e.altKey && !altGraph) || e.shiftKey) return null;

  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (ctx.editable || ctx.modalOpen || ctx.arrowWidget) return null;
    return e.key === "ArrowLeft" ? "prev" : "next";
  }
  if (e.repeat || ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen) return null;
  if (e.key === "Backspace") return "takeback";
  const code = e.code || (/^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : "");
  return LETTERS[code] ?? null;
}

/** The `?` dialog's "In Practice" section (registered through the review's helper while the screen is mounted). */
export const PRACTICE_SHORTCUTS: Omit<ShortcutSection, "scope"> & { scope: "review:practice" } = {
  title: "In Practice",
  scope: "review:practice",
  rows: [
    { id: "practice-takeback", label: "Take back your last move", keys: [["Backspace"]] },
    { id: "practice-reset", label: "Reset to the start position", keys: [["R"]] },
    { id: "practice-hint", label: "Hint, again for the arrow", keys: [["H"]] },
    { id: "practice-step", label: "Previous or next move of the line", keys: [["←"], ["→"]] },
    { id: "practice-flip", label: "Flip the board", keys: [["F"]] },
  ],
};
