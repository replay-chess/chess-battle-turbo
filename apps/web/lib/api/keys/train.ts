// Domain `train`: Mistake Bank, puzzles, sessions, themes (P5, phase-05 plan §5.1); weakness (P6).
import { norm } from "./norm";

/** The bank list's filters (URL state `?view=&theme=&phase=&source=`, cdl §6.4). Empty values are dropped by `norm`. */
export type BankFilter = {
  view?: "due" | "all";
  theme?: string;
  phase?: "opening" | "middlegame" | "endgame";
  source?: "own" | "missed";
};

export const trainKeys = {
  train: {
    all: () => ["train"] as const,
    /** R1 GET /api/train/today. */
    today: () => ["train", "today"] as const,
    /** R2 GET /api/train/bank (infinite): one entry per normalised filter. */
    bank: (f: BankFilter) => ["train", "bank", norm(f)] as const,
    /** R3 GET /api/train/sessions/:ref (items immutable, patched locally). */
    session: (ref: string) => ["train", "session", ref] as const,
    /** R3 `include=summary`: the session summary page's refetch while "Saving…". */
    summary: (ref: string) => ["train", "session", ref, "summary"] as const,
    /** R4 GET /api/train/themes. */
    themes: () => ["train", "themes"] as const,
    weakness: () => ["train", "weakness"] as const,
  },
};
