"use client";

// The passive activation watcher (phase-04 plan §5.7 "Passive activation": Done when the trial is not confirmed yet,
// Plan after a failed card return). useActivation in passive mode (WP-D): 5 s × 6 then 15 s for 180 s, only while
// the socket is not live, plus `entitlement:changed` through the "user" hold where the step boots the socket (Done).
// While the server says `pending` it keeps asking; `active` calls `onActive` once (the hook has already written the
// entitlement into `qk.me()`, reloaded the Clerk session and refreshed the socket token); a recorded failure stops it
// and calls `onFailed` once when given (Done sends the member back to the plan, FIX-1).
// Renders nothing. Plan loads it lazily, so the plan chunk carries no activation code.
import { useEffect, useRef } from "react";
import type { ActivationData } from "@repo/contracts/http/billing";
import { useActivation } from "@/lib/billing/useActivation";

export function ActivationWatcher({
  initial,
  onActive,
  onFailed,
}: {
  initial: ActivationData;
  onActive: () => void;
  /** A recorded failure (the card was declined or the checkout cancelled): Done's way out (FIX-1). */
  onFailed?: () => void;
}) {
  const { state } = useActivation({ kind: "onboarding", params: {}, initial, isReturn: false, source: "onboarding", passive: true });
  const fired = useRef(false);
  const callback = useRef({ onActive, onFailed });
  useEffect(() => {
    callback.current = { onActive, onFailed };
  });
  useEffect(() => {
    if (fired.current) return;
    if (state.phase === "success") {
      fired.current = true;
      callback.current.onActive();
    } else if (state.phase === "failed" && callback.current.onFailed) {
      fired.current = true;
      callback.current.onFailed();
    }
  }, [state.phase]);
  return null;
}
