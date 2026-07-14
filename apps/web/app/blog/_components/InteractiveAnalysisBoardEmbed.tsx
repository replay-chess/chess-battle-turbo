"use client";

import dynamic from "next/dynamic";
import type { InteractiveAnalysisBoardProps } from "./InteractiveAnalysisBoard";

const InteractiveAnalysisBoard = dynamic(
  () =>
    import("./InteractiveAnalysisBoard").then(
      (module) => module.InteractiveAnalysisBoard,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="relative left-1/2 my-12 flex min-h-64 w-[min(calc(100vw-2rem),64rem)] -translate-x-1/2 items-center justify-center border border-cb-border bg-cb-surface font-sans text-sm text-cb-text-muted">
        Loading interactive analysis…
      </div>
    ),
  },
);

export function InteractiveAnalysisBoardEmbed(
  props: InteractiveAnalysisBoardProps,
) {
  return <InteractiveAnalysisBoard {...props} />;
}
