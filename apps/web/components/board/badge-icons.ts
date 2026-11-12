// The owner's badge icon files (public/board_icons/svg) by badge kind: data only, so a page that only needs the file
// names (the public share page's island) does not import the board's layout code (FIX-2).
import type { BadgeKind } from "./types";

export const BADGE_ICON: Partial<Record<BadgeKind, string>> = {
  brilliant: "brilliant",
  great: "great_find",
  best: "best",
  excellent: "excellent",
  good: "good",
  book: "book",
  forced: "forced",
  inaccuracy: "inaccuracy",
  mistake: "mistake",
  miss: "missed_win",
  blunder: "blunder",
  win: "winner",
};

