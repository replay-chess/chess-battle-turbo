// Route loading for /review/[ref]/complete (plan §4.2): the page's own frame with skeleton tiles and rows, so the
// review's board skeleton (the parent segment's loading.tsx) never flashes on the way to the complete page.
import { Skeleton } from "@/components/ui/skeleton";
import "@/features/review/complete/complete.css";

function Sk({ w, h = 12 }: { w: number | string; h?: number }) {
  return <Skeleton style={{ display: "block", width: w, height: h }} />;
}

export default function ReviewCompleteLoading() {
  return (
    <div className="rvc" data-rc-lock="" aria-busy="true" data-testid="review-complete-loading">
      <span className="rvc-vh" role="status">
        Loading the review summary…
      </span>
      <div className="rvc__grid">
        <div className="rvc__left">
          <div className="rvc__lead">
            <Sk w={220} h={11} />
            <Sk w={280} h={40} />
            <Sk w={200} h={16} />
          </div>
          <div className="rvc__tiles">
            {[0, 1, 2].map((i) => (
              <div className="rvc-tile" key={i}>
                <Sk w={48} h={30} />
                <Sk w={64} h={10} />
              </div>
            ))}
          </div>
          <div className="rvc__primary">
            <Sk w="100%" h={48} />
          </div>
          <div className="rvc__rows">
            {[0, 1, 2].map((i) => (
              <div className="rvc-row" key={i}>
                <Sk w={180} />
              </div>
            ))}
          </div>
        </div>
        <div className="rvc__card">
          <div className="rvc__cardh">
            <Sk w={110} h={10} />
          </div>
          {[0, 1, 2].map((i) => (
            <div className="rvc-mrow" key={i}>
              <Skeleton className="rvc-mini" />
              <div className="rvc-mrow__body">
                <Sk w="70%" />
                <Sk w="90%" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
