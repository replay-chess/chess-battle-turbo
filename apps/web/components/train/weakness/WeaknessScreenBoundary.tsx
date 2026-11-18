"use client";

// The Weakness Profile pages' client boundary (phase-06 plan §4.9, §9.3): the screen under a client Suspense whose
// fallback is the design's `loading` state (WeaknessSkeleton). Rendered from the client so the skeleton is part of the
// route's JS, not serialised into every RSC flight: the pages seed the query, so the fallback only shows when the cache
// was dropped before a client navigation back here. As a server-rendered fallback it carried ≈ 9 KB of never-shown
// markup in each flight and put /train/weakness over its 12 KB RSC budget (regression: weakness-rsc-flight;
// e2e/specs/request-budget.spec.ts "P6 request budgets").
import { Suspense, type ComponentProps } from "react";
import { WeaknessScreen } from "./WeaknessScreen";
import { WeaknessSkeleton } from "./WeaknessSkeleton";

export function WeaknessScreenBoundary(props: ComponentProps<typeof WeaknessScreen>) {
  return (
    <Suspense fallback={<WeaknessSkeleton />}>
      <WeaknessScreen {...props} />
    </Suspense>
  );
}
