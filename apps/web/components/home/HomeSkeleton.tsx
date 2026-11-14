// Home `loading` (phase-05 plan §4.1; DR/V3HomeLoading): the same grid as HomeView with skeleton blocks, so the
// seeded screen replaces it without a shift. A server component (no client JavaScript); `loading.tsx` renders it
// during navigation, the demo route under `?state=loading`.
import { Skeleton, SkeletonBoard, SkeletonRegion } from "@/components/ui/skeleton";
import "./home.css";

function Tile({ minis = false, week = false }: { minis?: boolean; week?: boolean }) {
  return (
    <div className="hm-card hm-tile">
      <Skeleton className="h-2.5 w-1/2" />
      <Skeleton className="h-3 w-4/5" />
      {minis ? (
        <span className="hm-minis" aria-hidden="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </span>
      ) : null}
      {week ? (
        <span className="hm-week" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>
              <Skeleton className="size-2" />
              <Skeleton shape="circle" className="size-2.5" />
            </span>
          ))}
        </span>
      ) : null}
      <Skeleton className="hm-tile__cta h-11" />
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="hm-root" data-rc-lock="" data-testid="home-loading">
      <SkeletonRegion className="hm" label="Loading…">
        <div className="hm-head">
          <Skeleton className="h-7 w-72 max-w-full" />
        </div>
        <div className="hm-grid">
          <div className="hm-main">
            <div className="hm-card hm-cont" aria-hidden="true">
              <div className="hm-board">
                <SkeletonBoard />
              </div>
              <div className="hm-cont__body">
                <Skeleton className="h-2.5 w-[30%]" />
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-3 w-[90%]" />
                <Skeleton className="h-11 w-40" />
              </div>
            </div>
            <div className="hm-trio" aria-hidden="true">
              <Tile minis />
              <Tile week />
              <div className="hm-card hm-tile hm-play hm-tall">
                <Skeleton className="h-2.5 w-1/2" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="hm-tile__cta h-11" />
              </div>
            </div>
          </div>
          <div className="hm-card hm-recent" aria-hidden="true">
            <div className="hm-recent__head">
              <Skeleton className="h-2.5 w-28" />
            </div>
            <div className="hm-recent__list" style={{ overflow: "hidden" }}>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="hm-row" style={{ pointerEvents: "none" }}>
                  <Skeleton className="h-[18px]" />
                  <span className="flex flex-col gap-1.5">
                    <Skeleton className="h-2.5 w-1/2" />
                    <Skeleton className="h-2 w-[70%]" />
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </SkeletonRegion>
    </div>
  );
}
