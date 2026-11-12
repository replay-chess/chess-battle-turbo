// The compare page's route skeleton (phase-03 plan §4.6 `loading`; V3Skeletons): the BoardStage layout of the screen
// with skeleton chips and board, the aside's title lines, the four tab labels and four skeleton bars. Server-safe,
// CSS only; the board slot has the screen's exact size, so nothing moves when the screen arrives.
import { BoardStage } from "@/components/layout/BoardStage";
import { Skeleton, SkeletonBoard, SkeletonPlayerBar } from "@/components/ui/skeleton";
import "./compare.css";

export function CompareSkeleton() {
  return (
    <div data-rc-compare="" style={{ display: "contents" }} aria-busy="true" aria-label="Loading the comparison" data-testid="compare-loading-route">
      <BoardStage
        label="Board"
        top={<SkeletonPlayerBar className="w-full" />}
        bottom={<SkeletonPlayerBar className="w-full" />}
        board={<SkeletonBoard className="size-full" />}
        aside={
          <div className="lc-side">
            <div className="lc-head">
              <Skeleton className="h-2.5 w-[45%]" />
              <Skeleton className="h-9 w-[70%]" />
              <Skeleton className="h-3 w-[85%]" />
            </div>
            <div className="lc-tabs" aria-hidden="true">
              {["Explanation", "Your Moves", "Legend’s Moves", "Practice"].map((t) => (
                <span key={t} className="lc-tab" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="lc-panel">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-3.5 w-[90%]" />
              <Skeleton className="h-3.5 w-[70%]" />
              <Skeleton className="h-44 w-full" />
            </div>
          </div>
        }
      />
    </div>
  );
}
