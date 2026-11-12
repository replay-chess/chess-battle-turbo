// Practice's route skeleton (phase-03 plan §4.8; V3Skeletons): the BoardStage layout with skeleton chips and board,
// the aside's eyebrow, title and two lines, and the footer's three buttons. Server-safe, CSS only.
import { BoardStage } from "@/components/layout/BoardStage";
import { Skeleton, SkeletonBoard, SkeletonPlayerBar } from "@/components/ui/skeleton";
import "@/features/legend-compare/compare.css";
import "./practice.css";

export function PracticeSkeleton() {
  return (
    <div data-rc-practice="" style={{ display: "contents" }} aria-busy="true" aria-label="Loading practice" data-testid="practice-loading-route">
      <BoardStage
        label="Board"
        top={<SkeletonPlayerBar className="w-full" />}
        bottom={<SkeletonPlayerBar className="w-full" />}
        board={<SkeletonBoard className="size-full" />}
        aside={
          <div className="lc-side">
            <div className="pr-body">
              <Skeleton className="h-2.5 w-[40%]" />
              <Skeleton className="h-10 w-[75%]" />
              <Skeleton className="h-3.5 w-[90%]" />
              <Skeleton className="h-12 w-full" />
            </div>
            <div className="lc-foot" aria-hidden="true">
              <Skeleton className="h-11 flex-1" />
              <Skeleton className="h-11 flex-1" />
              <Skeleton className="h-11 flex-1" />
            </div>
          </div>
        }
      />
    </div>
  );
}
