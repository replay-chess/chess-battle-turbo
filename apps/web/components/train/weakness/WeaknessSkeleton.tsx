// WeaknessSkeleton (phase-06 plan §4.9; V3WeaknessProfile `loading` + the P1 V3Skeletons conventions): the real header
// (h1 static, the scope label as a ghost), 2 headline lines, then the grid: 3 ghost rows of 60 px on the left, a tab
// strip and 3 bar ghosts on the right; one column in the tab-bar form. One aria-busy region with an sr-only
// "Loading…"; the shimmer is static under reduced motion (Skeleton's own rule). Shown by the page's client Suspense
// fallback (a client navigation whose query cache was dropped) and the demo's `loading` state. There is no route
// loading.tsx: nothing under /train streams a skeleton (app/loading-boundaries.test.ts).
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { TopBarTitle } from "@/components/shell/TopBarTitle";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { copy } from "./copy";
import { FIT, FIT_INNER } from "./WeaknessFrame";

function GhostRow() {
  return (
    <span className="flex min-h-[60px] items-center gap-3 border border-cb-border bg-cb-surface px-3.5">
      <Skeleton className="size-4 shrink-0" />
      <span className="flex flex-auto flex-col gap-2">
        <Skeleton className="h-3 w-[45%]" />
        <Skeleton className="h-2.5 w-[30%]" />
      </span>
      <Skeleton className="h-3 w-[120px] shrink-0 tabbar:w-[80px]" />
    </span>
  );
}

export function WeaknessSkeleton() {
  return (
    <div data-rc-lock="" className="flex h-full min-h-0 flex-col" data-testid="weakness" data-status="loading">
      <TopBarTitle>
        <span className="truncate text-overline text-cb-text">{copy.title}</span>
      </TopBarTitle>
      {/* The ready frame (FIX-1): the board's loading state sits at the top of `.main.fit` like the profile it becomes;
          the centred FRAME made the h1 jump ≈ 255 px when the profile replaced it. */}
      <ScrollRegion label={copy.title} className={FIT}>
        <SkeletonRegion label={copy.loading} className={FIT_INNER}>
          <header className="flex flex-wrap items-end gap-3.5 tabbar:hidden">
            <h1 className="m-0 font-serif text-[clamp(1.75rem,3.6vh,2.25rem)]/[1.05] font-normal tracking-[-0.01em]">{copy.title}</h1>
            <Skeleton className="mb-1.5 h-3 w-64" />
          </header>
          <h1 className="sr-only hidden tabbar:block">{copy.title}</h1>
          <span className="flex flex-col gap-2">
            <Skeleton className="h-5 w-[70%] tabbar:w-full" />
            <Skeleton className="h-5 w-[45%]" />
          </span>
          <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-5 tabbar:grid-cols-1 tabbar:gap-3.5">
            <div className="flex flex-col gap-2.5">
              <GhostRow />
              <GhostRow />
              <GhostRow />
            </div>
            <div className="flex flex-col gap-3 border border-cb-border bg-cb-surface p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[85%]" />
              <Skeleton className="h-3 w-[70%]" />
            </div>
          </div>
        </SkeletonRegion>
      </ScrollRegion>
    </div>
  );
}
