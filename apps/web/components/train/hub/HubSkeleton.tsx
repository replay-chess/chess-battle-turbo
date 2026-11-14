// /train's loading state (phase-05 plan §4.2 `loading`; DR/V3TrainHubLoading.dc.html): the hub's grid with the static
// words in place (h1 Train, the section labels) and ghost blocks for everything data-driven, so the page replaces it
// without a shift. Server-compatible (loading.tsx renders it); one aria-busy region with an sr-only "Loading…".
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CARD } from "./parts";

function Rows({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="flex min-h-16 items-center gap-3 border-b border-cb-border px-4 last:border-b-0">
          <Skeleton className="size-5 shrink-0" />
          <span className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-[45%]" />
            <Skeleton className="h-2.5 w-[30%]" />
          </span>
        </span>
      ))}
    </>
  );
}

export function HubSkeleton() {
  return (
    <div data-rc-lock="" className="flex h-full min-h-0 flex-col" data-testid="train-hub" data-state="loading">
      <ScrollRegion
        label="Train"
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] items-center-safe px-8 py-7 narrow:p-5 vh640:px-6 vh640:py-3.5 tabbar:items-start tabbar:px-6 tabbar:py-4 [@media(max-width:600px)]:px-4 [@media(max-width:600px)]:pt-1"
      >
        <SkeletonRegion label="Loading today’s plan" className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
          <header className="flex flex-wrap items-end justify-between gap-6 [@media(max-width:600px)]:hidden">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-52" />
              <h1 className="m-0 font-serif text-[clamp(2rem,4.9vh,3rem)]/[1.05] font-normal tracking-[-0.01em] text-cb-text">Train</h1>
            </div>
            <Skeleton className="h-10 w-80" />
          </header>
          <div className="hidden [@media(max-width:600px)]:block">
            <h1 className="sr-only">Train</h1>
          </div>
          <Skeleton className="hidden h-6 w-full [@media(max-width:600px)]:block" />
          <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-6 tabbar:grid-cols-[minmax(0,1fr)] tabbar:gap-4">
            <div className="flex min-w-0 flex-col gap-5">
              <div className={cn(CARD, "flex flex-col gap-3.5 p-4")}>
                <Skeleton className="h-7 w-2/5" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-12 w-60 [@media(max-width:600px)]:hidden" />
              </div>
              <div className="flex flex-col gap-2.5 [@media(max-width:600px)]:hidden">
                <p className="m-0 text-overline">Due from your games</p>
                <div className="grid grid-cols-3 gap-2.5">
                  <Skeleton className="h-[76px]" />
                  <Skeleton className="h-[76px]" />
                  <Skeleton className="h-[76px]" />
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <div className={CARD}>
                <p className="m-0 px-4 pt-3.5 pb-1.5 text-overline">All training</p>
                <Rows n={2} />
              </div>
              <div className={cn(CARD, "flex flex-col gap-3 px-4 py-3.5 [@media(max-width:600px)]:hidden")}>
                <p className="m-0 text-overline">Theme mastery</p>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
          </div>
        </SkeletonRegion>
      </ScrollRegion>
      <div className="hidden shrink-0 border-t border-cb-border bg-cb-bg px-4 py-2 [@media(max-width:600px)]:block">
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
