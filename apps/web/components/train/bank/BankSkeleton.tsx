// /train/bank's loading state (phase-05 plan §4.3 `loading`; DR/V3MistakeBank `loading`, V3BankLoading and the device
// `loading` boards): the header with its h1, a board-sized block with the info lines, and 9 ghost rows (V3Skeletons
// `list`) in the list panel, laid out by the same grid as the screen. Server-compatible (loading.tsx renders it).
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { BOARD, INFO, SECTION } from "./BankDetail";

export const BANK_GHOST_ROWS = 9;

function GhostRow() {
  return (
    <span aria-hidden="true" className="flex min-h-[72px] items-center gap-3 border-b border-cb-border px-3 tabbar:px-0">
      <Skeleton className="size-14 shrink-0" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-[60%]" />
        <Skeleton className="h-2.5 w-[40%]" />
      </span>
    </span>
  );
}

export function BankSkeleton() {
  return (
    <div
      data-rc-lock=""
      className="flex h-full min-h-0 flex-col gap-4 px-8 pt-6 pb-6 narrow:px-5 vh760:gap-2.5 vh760:px-6 vh760:py-3.5 tabbar:gap-2 tabbar:px-0 tabbar:pt-1 tabbar:pb-0"
      data-testid="train-bank"
      data-state="loading"
    >
      <header className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-3 tabbar:hidden">
        <h1 className="m-0 font-serif text-[clamp(1.75rem,3.6vh,2.25rem)]/[1.05] font-normal tracking-[-0.01em] text-cb-text">Mistake Bank</h1>
        <Skeleton className="h-6 w-56" />
        <span className="flex-auto" />
        <Skeleton className="h-11 w-24" />
        <Skeleton className="h-11 w-48" />
      </header>
      <div className="hidden tabbar:block">
        <h1 className="sr-only">Mistake Bank</h1>
      </div>
      <SkeletonRegion
        label="Loading your Mistake Bank"
        className="mx-auto grid min-h-0 w-full max-w-[1280px] flex-1 grid-cols-[minmax(0,1fr)_440px] gap-5 vh760:grid-cols-[minmax(0,1fr)_360px] rail:grid-cols-[minmax(0,1fr)_400px] tabbar:flex tabbar:flex-col tabbar:gap-2 tabbar:px-4 tablet-portrait:px-6"
      >
        <div className={SECTION}>
          <Skeleton className={cn(BOARD, "aspect-square")} />
          <div className={cn(INFO, "flex flex-col gap-2")}>
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-7 w-4/5" />
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden border border-cb-border bg-cb-surface tabbar:border-0 tabbar:bg-transparent">
          <span aria-hidden="true" className="flex items-center gap-2 border-b border-cb-border px-3 py-2.5 tabbar:px-0">
            <Skeleton className="h-10 w-40" />
            <span className="flex-auto" />
            <Skeleton className="h-11 w-24" />
          </span>
          {Array.from({ length: BANK_GHOST_ROWS }, (_, i) => (
            <GhostRow key={i} />
          ))}
        </div>
      </SkeletonRegion>
      <div className="hidden shrink-0 border-t border-cb-border bg-cb-bg px-4 py-2 tabbar:block tablet-portrait:px-6">
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
