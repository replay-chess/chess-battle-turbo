// Route loading for /review/[ref] (plan §4.1 `loading`; V3Skeletons `review`): BoardStage with skeleton strips, the
// board from the start position, an "Analysing" placeholder card and ghost move rows. The board size is CSS only, so
// the real screen replaces it without a layout shift. The phone tab bar stays hidden, as on the screen itself.
import { BoardStage } from "@/components/layout/BoardStage";
import { LoadingBoard } from "@/features/review/components/LoadingBoard";
import "@/features/review/review.css";


function Sk({ w, h = 10 }: { w: number | string; h?: number }) {
  return <span className="g-sk" style={{ display: "block", width: w, height: h, background: "var(--cb-fill)" }} />;
}

function StripSkeleton() {
  return (
    <div className="rv-pbar" aria-hidden="true">
      <span className="rv-pbar__who">
        <span className="rv-av" />
        <Sk w={120} />
      </span>
      <Sk w={90} />
    </div>
  );
}

export default function ReviewLoading() {
  return (
    <div data-rc-review="" style={{ display: "contents" }} aria-busy="true" aria-label="Loading review" data-testid="review-loading">
      <BoardStage
        label="Board"
        top={<StripSkeleton />}
        bottom={<StripSkeleton />}
        board={
          <div className="rv-boardarea">
            <div className="rv-evalbar" aria-hidden="true">
              <span style={{ height: "50%" }} />
            </div>
            <LoadingBoard />
          </div>
        }
        aside={
          <div className="rv-side">
            <div className="rv-head" data-rv-side="">
              <Sk w="60%" h={22} />
              <Sk w="45%" />
            </div>
            <div className="rv-section" role="status">
              <span className="rv-section__row">
                <span className="rv-spin" aria-hidden="true" />
                <span style={{ fontWeight: 500 }}>Analysis loading · graded moves appear as they finish</span>
              </span>
              <div className="rv-bar" aria-hidden="true">
                <span style={{ width: "0%" }} />
              </div>
            </div>
            <div className="rv-moves" aria-hidden="true" data-rv-side="">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} style={{ display: "contents" }}>
                  <span className="rv-moves__no">{i + 1}.</span>
                  <span style={{ padding: "11px 8px" }}>
                    <Sk w="55%" />
                  </span>
                  <span style={{ padding: "11px 8px" }}>
                    <Sk w="45%" />
                  </span>
                </span>
              ))}
            </div>
          </div>
        }
        footer={<div className="rv-abar" aria-hidden="true" />}
      />
    </div>
  );
}
