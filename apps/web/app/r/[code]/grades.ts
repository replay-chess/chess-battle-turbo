// Grade art and names for the public share page: the owner's badge icons (public/board_icons/svg, the same files the
// board draws) and the review's label names. Interesting has no icon: callers draw the DS disc with "!?".
import { BADGE_ICON } from "@/components/board/badge-icons";
import type { JudgementKey } from "@repo/chess-analysis/codec";
import { QUALITY_LABEL } from "@/features/review/quality-labels";

/** `/board_icons/svg/<name>.svg`, or null for a label without an icon (Interesting). */
export function gradeIcon(q: JudgementKey): string | null {
  const file = BADGE_ICON[q];
  return file ? `/board_icons/svg/${file}.svg` : null;
}

/** "Miss", "Brilliant" … */
export function gradeName(q: JudgementKey): string {
  return QUALITY_LABEL[q];
}
