// The `loading` state of /games (plan §4.9; V3Skeletons `list`): 9 ghost rows in the list card and a board
// placeholder in the aside. Server-compatible (loading.tsx renders it before any client code); every block is
// aria-hidden and the region carries aria-busy plus one sr-only line.
import { Skeleton, SkeletonBoard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ArchiveHeaderFrame } from "./ArchiveHeaderFrame";
import { ASIDE, CARD, GHOST_ROWS, GRID, PAGE, ROW_GRID, WIDE_ONLY } from "./layout";

export function GhostRows({ count = GHOST_ROWS }: { count?: number }) {
  return (
    <div aria-hidden="true" data-testid="games-ghost-rows">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn(ROW_GRID, "pointer-events-none border-b border-cb-border")}>
          <Skeleton className="h-[18px] w-12" />
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-2.5 w-1/2" />
            <Skeleton className="h-2 w-[70%]" />
          </span>
          <Skeleton className={cn("h-2.5", WIDE_ONLY)} />
          <Skeleton className="h-2.5" />
          <Skeleton className="h-2.5" />
        </div>
      ))}
    </div>
  );
}

export function AsideSkeleton() {
  return (
    <aside aria-hidden="true" className={cn(CARD, ASIDE)} data-testid="games-aside-skeleton">
      <SkeletonBoard className="tablet-portrait:w-[200px] tablet-portrait:shrink-0" />
      <span className="flex w-full flex-col gap-2">
        <Skeleton className="h-2.5 w-1/3" />
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </span>
      <Skeleton className="h-11 w-full" />
    </aside>
  );
}

/** The whole screen while the first page streams (loading.tsx). */
export function ArchiveSkeleton() {
  return (
    <div data-rc-lock="" className={PAGE} data-testid="games-archive" data-state="loading">
      <ArchiveHeaderFrame />
      <div className={GRID}>
        <section aria-label="Games" aria-busy="true" className={cn(CARD, "flex flex-col")}>
          <span className="sr-only" role="status">
            Loading your games…
          </span>
          <GhostRows />
        </section>
        <AsideSkeleton />
      </div>
    </div>
  );
}
