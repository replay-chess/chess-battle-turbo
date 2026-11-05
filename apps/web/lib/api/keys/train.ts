// Domain `train`: Mistake Bank, puzzles, weakness (P5, P6).
import { norm, type Filters } from "./norm";

/** Narrowed by P5 (`{ view?, theme?, phase?, source? }`). */
export type BankFilter = Filters;

export const trainKeys = {
  train: {
    all: () => ["train"] as const,
    today: () => ["train", "today"] as const,
    bank: (f: BankFilter) => ["train", "bank", norm(f)] as const,
    session: (ref: string) => ["train", "session", ref] as const,
    themes: () => ["train", "themes"] as const,
    weakness: () => ["train", "weakness"] as const,
  },
};
