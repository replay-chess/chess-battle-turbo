"use client";

// In-panel toast (plan 4.2 rule 5): game toasts render inside the panel (desktop) or above the control bar
// (phones), never in the global Sonner stack, so they never cover the board or the clocks. A toast clears itself
// after a few seconds; toast-led primary states (illegal, rejected, premove_cancelled, draw_declined, reconnected,
// opp_reconnected, over_rematch_declined/expired) return to their base state with it.

import { useEffect } from "react";
import { absPly } from "@repo/game-core/client/reducer";
import { copyCtx, toastText } from "../copy";
import { useController, useDispatch, useGame, useView } from "./GameContext";

export const TOAST_MS = 4_000;
/** Toasts that stay while their cause lasts (the premove is still queued, the opponent is still away). */
const STICKY = new Set(["premove_set", "opp_disconnected", "study_reconnect", "already_ended", "rematch_accepted"]);

export function GameToast() {
  const view = useView();
  const controller = useController();
  const dispatch = useDispatch();
  const state = useGame((g) => g.state);
  const stored = useGame((g) => g.toast);
  const toast = view.toast;

  useEffect(() => {
    if (!stored || STICKY.has(stored.code)) return;
    const id = setTimeout(() => dispatch({ type: "toastClear" }), TOAST_MS);
    return () => clearTimeout(id);
  }, [stored, dispatch]);

  if (!toast) return null;
  const text = toastText(toast, copyCtx(state), state, absPly(state), controller.serverNow() - Date.now());
  if (!text) return null;
  return (
    <div className="g-toastwrap">
      <div className="g-toast" role="status" aria-live="polite" data-testid="game-toast" data-code={toast.code}>
        <span className="g-tdot" data-kind={toast.kind} aria-hidden="true" />
        <span style={{ flex: "1 1 auto" }}>{text}</span>
      </div>
    </div>
  );
}
