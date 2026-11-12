"use client";

// The complete page's keys (phase-03 plan §4.2 "Interactions"): Enter = the primary (Play Again), Esc = back to the
// review. Same gates as the review's own keys (SPEC D20): Enter needs a fine pointer, the Single-Key Shortcuts switch
// and focus outside a control or a field (a focused button or link activates itself); Esc never fires inside a
// field or while a dialog or menu is open (they close themselves).

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { COARSE_MQ } from "@/lib/layout/media-queries";
import { isEditableTarget, MODAL_OPEN_SELECTOR } from "@/lib/shell/key-target";
import { singleKeyEnabledNow } from "@/lib/shell/prefs";
import { CONTROL_SELECTOR } from "../keys/hotkeys";

export function CompleteKeys({ primaryHref, backHref }: { primaryHref: string; backHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isEditableTarget(e.target) || document.querySelector(MODAL_OPEN_SELECTOR)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(backHref);
        return;
      }
      if (e.key !== "Enter" || e.shiftKey) return;
      if (e.target instanceof Element && e.target.closest(CONTROL_SELECTOR)) return;
      if (window.matchMedia(COARSE_MQ).matches || !singleKeyEnabledNow()) return;
      e.preventDefault();
      router.push(primaryHref);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, primaryHref, backHref]);
  return null;
}
