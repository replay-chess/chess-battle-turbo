// Compare's keys (phase-03 plan §4.6 "Interactions"): Space play/pause the narration; ←/→ step the board along the
// active line; ↑/↓ first/last; 1–4 the tabs; arrow keys inside the tablist stay the tablist's. Pure: `compareKeyFor`
// names the action a keydown means, or null. Same gates as the review (features/review/keys/hotkeys.ts): digits and
// Space need a fine pointer, single-key shortcuts on, no field and no modal; arrows work with any pointer but never in
// a field, a modal or a widget that owns them; Space is left to a focused button.
import type { ReviewKeyContext, ReviewKeyLike } from "@/features/review/keys/hotkeys";
import type { ShortcutSection } from "@/lib/shell/shortcuts";
import type { CompareTab } from "./model";

export type CompareKey = "prev" | "next" | "first" | "last" | "narration" | { tab: CompareTab };

const DIGIT_TAB: Record<string, CompareTab> = {
  Digit1: "explanation",
  Digit2: "your_moves",
  Digit3: "legend_moves",
  Digit4: "practice",
};

export function compareKeyFor(e: ReviewKeyLike, ctx: ReviewKeyContext): CompareKey | null {
  if (e.defaultPrevented || e.isComposing || e.key === "Process") return null;
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  if (e.metaKey || (e.ctrlKey && !altGraph) || (e.altKey && !altGraph)) return null;
  if (e.shiftKey) return null;

  if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (ctx.editable || ctx.modalOpen || ctx.arrowWidget) return null;
    return e.key === "ArrowLeft" ? "prev" : e.key === "ArrowRight" ? "next" : e.key === "ArrowUp" ? "first" : "last";
  }

  if (e.repeat || ctx.coarse || !ctx.singleKeyEnabled || ctx.editable || ctx.modalOpen) return null;
  if (e.key === " " || e.code === "Space") return ctx.onControl ? null : "narration";
  const code = e.code || (/^[1-4]$/.test(e.key) ? `Digit${e.key}` : "");
  const tab = DIGIT_TAB[code];
  return tab ? { tab } : null;
}

/** The `?` dialog's "In Compare" section (registered through the review's helper while the screen is mounted). */
export const COMPARE_SHORTCUTS: Omit<ShortcutSection, "scope"> & { scope: "review:compare" } = {
  title: "In Compare",
  scope: "review:compare",
  rows: [
    { id: "compare-step", label: "Previous or next move on the line", keys: [["←"], ["→"]] },
    { id: "compare-ends", label: "First or last move", keys: [["↑"], ["↓"]] },
    { id: "compare-narration", label: "Play or pause the narration", keys: [["Space"]] },
    { id: "compare-tabs", label: "Explanation, your moves, the legend’s moves, practice", keys: [["1"], ["2"], ["3"], ["4"]] },
  ],
};
