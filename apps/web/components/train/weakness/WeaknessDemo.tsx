"use client";

// /dev/ui/weakness (phase-06 plan §4.1 demo route, §7.6, TE X8/X9): the Weakness Profile in every state from WP1's
// fixtures (`__fixtures__/payloads.ts`, built by the real buildPayload), with no server. The real view component and
// its interactions (accordion, See all, tabs, the drill config and sheet with size and mix); nothing is sent: Retry and
// Include bullet show their pending state for a moment, Start shows its spinner. `lesson=1` fills the P8 lesson slots,
// `stress=1` uses the longest labels and names. The design's example positions are attached to the first three rows
// (the fixtures carry none), so the rows look as on the board.
import { useEffect, useReducer, useState } from "react";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { initialViewState, viewReducer } from "@/features/train/weakness/view-state";
import { TABBAR_QUERY } from "./classes";
import { demoInitialTab, demoPayload, demoSelected, type WeaknessDemoState } from "./demo-states";
import type { DrillSize } from "./DrillConfig";
import { WeaknessSkeleton } from "./WeaknessSkeleton";
import { WeaknessView } from "./WeaknessView";

const LIMITED: RetryCountdownState = {
  limited: true,
  ready: false,
  left: 592,
  label: "9:52",
  rowId: "weakness-demo-limit",
  controlProps: { "aria-disabled": true, "aria-describedby": "weakness-demo-limit" },
  error: null,
};

export function WeaknessDemo({ state, lesson, stress }: { state: WeaknessDemoState; lesson: boolean; stress: boolean }) {
  const [payload] = useState(() => demoPayload(state, { lesson, stress }));
  const [view, dispatch] = useReducer(viewReducer, undefined, () => {
    const v = initialViewState(demoInitialTab(state), payload.status);
    if (state === "see_all") return { ...v, showAll: true };
    if (state === "ready_flash") return { ...v, flash: true };
    return v;
  });
  const [selected, setSelected] = useState<string | null>(() => demoSelected(state, payload));
  const [drill, setDrill] = useState<{ size: DrillSize; mix: boolean }>(() => ({ size: state === "drill_size20" ? 20 : 10, mix: state !== "drill_mix_off" }));
  const [pending, setPending] = useState<"start" | "recompute" | null>(state === "drill_starting" ? "start" : null);
  const sheetMode = useMediaQuery(TABBAR_QUERY);

  useEffect(() => {
    if (!selected || sheetMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, sheetMode]);

  if (state === "loading") return <WeaknessSkeleton />;

  const flashPending = (kind: "start" | "recompute") => {
    setPending(kind);
    setTimeout(() => setPending(null), 1_200);
  };

  return (
    <WeaknessView
      payload={payload}
      view={view}
      selectedSlug={selected}
      sheetMode={sheetMode}
      linked={false}
      drill={{
        size: drill.size,
        mix: drill.mix,
        onSize: (size) => setDrill((d) => ({ ...d, size })),
        onMix: (mix) => setDrill((d) => ({ ...d, mix })),
        onStart: () => flashPending("start"),
        starting: pending === "start",
        emptyFromServer: false,
        limit: state === "drill_rate_limited" ? LIMITED : undefined,
      }}
      recompute={{
        pending: pending === "recompute",
        limit: state === "failed_rate_limited" ? LIMITED : undefined,
        failedAgain: state === "failed_again",
        eventId: state === "failed_again" ? "7f3a9c21" : null,
      }}
      handlers={{
        onToggleRow: (index) => dispatch({ type: "toggleRow", index }),
        onToggleShowAll: () => dispatch({ type: "toggleShowAll" }),
        onTab: (tab) => dispatch({ type: "setTab", tab }),
        onDrill: (row) => {
          setSelected(row.slug);
          setDrill({ size: 10, mix: true });
        },
        onCloseDrill: () => setSelected(null),
        onPlanFollow: () => {},
        onSeeProfile: () => dispatch({ type: "dismissFlash" }),
        onRetry: () => flashPending("recompute"),
        onIncludeBullet: () => flashPending("recompute"),
        onImport: () => {},
        onPlay: () => {},
      }}
    />
  );
}
