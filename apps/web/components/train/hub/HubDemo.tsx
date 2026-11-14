"use client";

// /dev/ui/train/hub (phase-05 plan §2.1 "Dev demo routes"): the hub in every board state from WP-A's contract fixtures
// (`app/dev/ui/_fixtures/train.ts`), with no server. `loading` is the in-place plan skeleton of V3TrainHubLoading (the
// header and All training stay); `route=1` shows loading.tsx's full skeleton instead. Start shows its pending state
// for a moment and goes nowhere (there is no session server here).
import { useState } from "react";
import { hubDemo, P5_FIXTURE_NOW, type HubDemoState } from "@/app/dev/ui/_fixtures/train";
import { trainTodayFixture } from "@repo/contracts/http/fixtures/p05";
import { HubSkeleton } from "./HubSkeleton";
import { TrainHubView } from "./TrainHubView";
import { dayWord, safeTimeZone } from "./when";

const DEMO_NOW_MS = Date.parse(P5_FIXTURE_NOW);

export function HubDemo({ state, stress, routeSkeleton }: { state: HubDemoState; stress: boolean; routeSkeleton: boolean }) {
  const [starting, setStarting] = useState(false);
  if (state === "loading" && routeSkeleton) return <HubSkeleton />;
  const today = hubDemo(state, stress) ?? trainTodayFixture(stress ? "stress" : "default");
  const nextDay = today.nextBatch ? dayWord(today.nextBatch.at, DEMO_NOW_MS, safeTimeZone(today.prefs.timeZone)) : null;
  return (
    <TrainHubView
      today={today}
      nextDay={nextDay}
      planLoading={state === "loading"}
      starting={starting}
      onStart={() => {
        setStarting(true);
        setTimeout(() => setStarting(false), 1_200);
      }}
    />
  );
}
