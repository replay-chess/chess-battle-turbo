// Enter inside a radio group submits the step's form (phase-04 plan §4.0 "Enter submits the primary action").
// The UI kit's Segmented is a Radix radio group, which cancels Enter on its items (WAI-ARIA radios never activate on
// Enter), so the browser's implicit submission never happens there; a wrapper's onKeyDown restores it.
import type { KeyboardEvent } from "react";

export function submitOnEnter(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== "Enter" || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement | null;
  if (!target || target.getAttribute("role") !== "radio") return;
  e.preventDefault();
  target.closest("form")?.requestSubmit();
}
