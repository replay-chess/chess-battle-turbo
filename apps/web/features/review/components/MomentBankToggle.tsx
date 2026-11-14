"use client";

// The key moment's Mistake Bank toggle (phase-05 plan §4.8, §5.3 A6 row; V3KeyMoments "Add this position to my
// Mistake Bank"; owner WP-H). Rendered in KeyMomentStepper's answered section while `train` is on.
//
//   change / B   optimistic: the moment's `inBank` flips in A1 at once; A6 (P3's useToggleMomentInBank, set semantics)
//                then writes `bankOptOut` and creates or deletes the BANK card in one transaction; the A1 refetch
//                after it settles brings the card. Toasts: "Added to Mistake Bank · next review tomorrow" /
//                "Removed from Mistake Bank" with Undo. A failure rolls the checkbox back with an error toast (409
//                `not_bankable`: "This position can't be added to your Mistake Bank"). The answer is handled by the
//                mutation itself, so a slow switch still toasts and rolls back after the member moved to another
//                moment or left the review; Finish Review waits for a switch still on the wire before A7
//                (trackReviewWrite; regression: first-add-finish-race).
//   stale        every bank list, today's plan, Home and the badge (refetched where they are next shown).
// The /dev/ui demo flips the cached payload only (no request). B is registered in the `?` list while mounted.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReviewDTO } from "@repo/contracts/http/review";
import { CheckboxRow } from "@/components/ui/checkbox";
import { notify } from "@/components/ui/toast";
import { qk } from "@/lib/api/keys";
import { useToggleMomentInBank, type MomentBankToggleInput } from "@/lib/api/mutations/review";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";
import type { ShortcutSection } from "@/lib/shell/shortcuts";
import { BANK_TOGGLE_COPY, BANK_TOGGLE_STALE_KEYS, bankToggleErrorCopy, momentCardOf, withMomentBank } from "../bank";
import { useReview } from "../context";
import { CONTROL_SELECTOR, REVIEW_ARROW_WIDGET_SELECTOR, reviewHotkeyFor } from "../keys/hotkeys";
import { useReviewShortcuts } from "../keys/useReviewShortcuts";
import { trackReviewWrite } from "../useReviewProgressSync";

const BANK_SHORTCUTS: Omit<ShortcutSection, "scope"> & { scope: "review:bank" } = {
  title: BANK_TOGGLE_COPY.shortcutTitle,
  scope: "review:bank",
  rows: [{ id: "review-bank", label: BANK_TOGGLE_COPY.shortcutRow, keys: [["B"]] }],
};

function closest(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

export function MomentBankToggle({ ply, inBank }: { ply: number; inBank: boolean }) {
  const { refId, demo } = useReview();
  const qc = useQueryClient();
  const key = qk.review.detail(refId);
  const toggle = useToggleMomentInBank(refId, {
    track: (settled) => trackReviewWrite(refId, settled),
    onSuccess: (res, input) => {
      const current = qc.getQueryData<ReviewDTO>(key);
      if (current) qc.setQueryData<ReviewDTO>(key, withMomentBank(current, input.ply, res.inBank, momentCardOf(res)));
      markStale();
      if (input.undo) return;
      if (res.inBank) notify.success(BANK_TOGGLE_COPY.added(res.card?.dueLabel ?? null));
      else notify.undo(BANK_TOGGLE_COPY.removed, { onUndo: () => send({ ply: input.ply, inBank: true, undo: true }) });
    },
    onError: (error, input) => {
      const current = qc.getQueryData<ReviewDTO>(key);
      if (current) qc.setQueryData<ReviewDTO>(key, withMomentBank(current, input.ply, !input.inBank, null));
      notify.error(bankToggleErrorCopy(error));
    },
  });
  useReviewShortcuts("bank", BANK_SHORTCUTS);

  function markStale() {
    for (const k of BANK_TOGGLE_STALE_KEYS) void qc.invalidateQueries({ queryKey: k, refetchType: "none" });
  }

  /** The optimistic flip, then A6 (the mutation's own handlers answer it, mounted or not). */
  function send(input: MomentBankToggleInput) {
    const before = qc.getQueryData<ReviewDTO>(key);
    if (before) qc.setQueryData<ReviewDTO>(key, withMomentBank(before, input.ply, input.inBank, null));
    toggle.mutate(input);
  }

  const set = (next: boolean) => {
    if (demo) {
      const before = qc.getQueryData<ReviewDTO>(key);
      if (before) qc.setQueryData<ReviewDTO>(key, withMomentBank(before, ply, next, null));
      if (next) notify.success(BANK_TOGGLE_COPY.added("tomorrow"));
      else
        notify.undo(BANK_TOGGLE_COPY.removed, {
          onUndo: () => {
            const current = qc.getQueryData<ReviewDTO>(key);
            if (current) qc.setQueryData<ReviewDTO>(key, withMomentBank(current, ply, true, null));
          },
        });
      return;
    }
    send({ ply, inBank: next });
  };

  // B toggles while this answered moment is on screen (the review's own listener leaves B to us).
  const latest = useRef({ inBank, set });
  useEffect(() => {
    latest.current = { inBank, set };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (closest(e.target, '[role="menu"], [role="menubar"]')) return;
      const hot = reviewHotkeyFor(e, {
        coarse: window.matchMedia(COARSE_MQ).matches,
        singleKeyEnabled: singleKeyEnabledNow(),
        editable: isEditableTarget(e.target),
        modalOpen: document.querySelector(MODAL_OPEN_SELECTOR) !== null,
        arrowWidget: closest(e.target, REVIEW_ARROW_WIDGET_SELECTOR),
        onControl: closest(e.target, CONTROL_SELECTOR),
      });
      if (hot !== "bank") return;
      e.preventDefault();
      latest.current.set(!latest.current.inBank);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CheckboxRow
      label={BANK_TOGGLE_COPY.label}
      checked={inBank}
      onCheckedChange={(v) => set(v)}
      // A stable id per moment, not useId: useId hydrated to a different id inside the review panel.
      id={`moment-bank-${ply}`}
      className="min-h-12"
      data-testid="moment-bank-toggle"
    />
  );
}
