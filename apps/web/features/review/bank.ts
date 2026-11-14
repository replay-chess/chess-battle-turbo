// The key moment's Mistake Bank toggle (phase-05 plan §4.8 "Review key moments", V3KeyMoments; P3-D19; owner WP-H).
// Pure: the optimistic A1 patch, its copy and the cache keys a toggle makes stale. The component is
// components/MomentBankToggle.tsx; A6 is P3's `useToggleMomentInBank` (set semantics, then the A1 refetch).
import type { QueryKey } from "@tanstack/react-query";
import type { MomentBankResponse, ReviewDTO } from "@repo/contracts/http/review";
import type { MomentCard } from "@repo/contracts/http/train";
import { qk } from "@/lib/api/keys";

export const BANK_TOGGLE_COPY = {
  label: "Add this position to my Mistake Bank",
  /** Toasts: one sentence, no trailing period (P1 notify rule). */
  added: (dueLabel: string | null) => (dueLabel ? `Added to Mistake Bank · next review ${dueLabel}` : "Added to Mistake Bank"),
  removed: "Removed from Mistake Bank",
  failed: "Couldn't update your Mistake Bank",
  shortcutTitle: "In a Key Moment",
  shortcutRow: "Add to or remove from the Mistake Bank",
} as const;

/** A1 with one moment's bank fields replaced (the same object when nothing changes or the ply is unknown). */
export function withMomentBank(dto: ReviewDTO, ply: number, inBank: boolean, card: MomentCard | null): ReviewDTO {
  const review = dto.review;
  if (!review) return dto;
  const i = review.moments.findIndex((m) => m.ply === ply);
  if (i < 0) return dto;
  const m = review.moments[i]!;
  if (m.inBank === inBank && (m.card ?? null) === card) return dto;
  const moments = review.moments.slice();
  moments[i] = { ...m, inBank, card };
  return { ...dto, review: { ...review, moments } };
}

/** A6's card in A1's shape (`{ref, dueLabel}`). */
export function momentCardOf(res: Pick<MomentBankResponse, "card">): MomentCard | null {
  return res.card ? { ref: res.card.ref, dueLabel: res.card.dueLabel } : null;
}

/** What a toggle makes stale (no refetch now): every bank list, today's plan, Home and the badge (plan §5.3 A6 row). */
export const BANK_TOGGLE_STALE_KEYS: readonly QueryKey[] = [qk.train.all(), qk.home(), qk.badges()];
