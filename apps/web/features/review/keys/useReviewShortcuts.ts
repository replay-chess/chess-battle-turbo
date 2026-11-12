"use client";

// The review's shortcut helper for its neighbour screens (phase-03 plan §13.1 shared-file locks: "G registers its
// shortcuts through F's helper registerReviewShortcuts()"). A screen lists its keys in the `?` dialog while it is
// mounted, in its own `review:<area>` scope:
//
//   useReviewShortcuts("compare", {
//     title: "In Compare",
//     scope: "review:compare",
//     rows: [{ id: "compare-tabs", label: "Explanation, your moves, the legend's moves, practice", keys: [["1"], ["2"], ["3"], ["4"]] }],
//   });
//
// The section is registered once per mount (pass a stable object: a module constant). The keys themselves stay the
// screen's own listener (as useReviewHotkeys does for the review).

import { useEffect } from "react";
import { registerReviewShortcuts, type ShortcutSection } from "@/lib/shell/shortcuts";

export { registerReviewShortcuts };

export function useReviewShortcuts(id: string, section: Omit<ShortcutSection, "scope"> & { scope: `review:${string}` }): void {
  useEffect(() => registerReviewShortcuts(id, section), [id, section]);
}
