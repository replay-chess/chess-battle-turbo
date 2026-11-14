// The runner's loading state (`loading.tsx` of /train/bank/session and /train/puzzles, and the page's answer to a
// router prefetch, which must never create a session, §5.1): the same BoardStage geometry as the runner, so nothing
// moves when the payload arrives (CLS ≤ 0.02, §9.6). Server component, `aria-busy` with one sr-only "Loading…".
import { BoardStage } from "@/components/layout/BoardStage";
import { Skeleton, SkeletonBoard, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";
import "./trainer.css";

export function RunnerSkeleton({ label = "Loading the session" }: { label?: string }) {
  return (
    <div data-rc-trainer="" style={{ display: "contents" }} data-testid="trainer-loading">
      <SkeletonRegion label={label} className="contents">
        <BoardStage
          label="Puzzle board"
          asideWidth="trainer"
          bars="labels"
          top={<Skeleton className="h-3 w-[40%]" />}
          bottom={<Skeleton className="h-3 w-[25%]" />}
          board={<SkeletonBoard />}
          aside={
            <div className="tr-panel" aria-hidden="true">
              <div className="tr-head tr-side-only">
                <Skeleton className="h-6 w-[45%]" />
                <Skeleton className="h-2.5 w-[30%]" />
              </div>
              <div className="tr-body">
                <Skeleton className="h-6 w-[60%]" />
                <SkeletonText lines={3} />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
          }
          footer={<div className="tr-ctl" data-k="done" />}
        />
      </SkeletonRegion>
    </div>
  );
}
