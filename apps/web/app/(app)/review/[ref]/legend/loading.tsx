// Route loading for /review/[ref]/legend (plan §4.6 `loading`): BoardStage with skeleton chips, a skeleton board, the
// aside's title lines, the tab strip and four skeleton bars. CSS only, so the screen replaces it without a shift.
import { CompareSkeleton } from "@/features/legend-compare/CompareSkeleton";

export default function LegendCompareLoading() {
  return <CompareSkeleton />;
}
