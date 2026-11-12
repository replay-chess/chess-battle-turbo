// Route loading for /review/[ref]/share (plan §4.3): the page's own frame (the card and the controls as skeletons),
// so the review's board skeleton never flashes on the way here.
import { Skeleton } from "@/components/ui/skeleton";
import "@/features/share/share.css";

function Sk({ w, h = 12 }: { w: number | string; h?: number }) {
  return <Skeleton style={{ display: "block", width: w, height: h }} />;
}

export default function ReviewShareLoading() {
  return (
    <div className="sh" data-rc-lock="" aria-busy="true" data-testid="review-share-loading">
      <span className="sh-vh" role="status">
        Loading the share page…
      </span>
      <div className="sh__grid">
        <div className="sh__preview">
          <div className="sh-card">
            <div className="sh-card__top">
              <Sk w={120} h={20} />
              <Sk w={80} h={10} />
            </div>
            <div className="sh-card__body">
              <Skeleton className="sh-card__board" />
              <div className="sh-card__facts">
                <Sk w="80%" />
                <Sk w="50%" />
                <Sk w={48} h={28} />
              </div>
            </div>
          </div>
        </div>
        <div className="sh__controls">
          <Sk w={110} h={10} />
          <Sk w={260} h={40} />
          <Sk w="90%" h={14} />
          <Sk w="100%" h={48} />
          <Sk w="70%" h={14} />
        </div>
      </div>
    </div>
  );
}
