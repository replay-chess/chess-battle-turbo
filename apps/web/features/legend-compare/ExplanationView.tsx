"use client";

// The Explanation tab (phase-03 plan §4.6 states `default` · Explanation, `no_explanation`, `audio_failed`,
// variant `pending_evals`; moved from the legacy ExplanationView). Always the template paragraph built from the facts
// (§8.9) and the "Win chances after the split" row (a ghost until the evals arrive). With an authored explanation:
// the narration player (when the position has audio) and the segment list. Without one: the P3 copy that points to
// the other tabs (the board's "The coach is still writing this one" belongs to P7's personalised narration).
import type { LegendCompareDTO, StaticExplanation } from "@repo/contracts/http/legend";
import { Skeleton } from "@/components/ui/skeleton";
import { evalRow, APOS } from "./model";
import { NarrationPlayer } from "./NarrationPlayer";
import { SegmentList } from "./SegmentList";
import type { NarrationPlayer as Player } from "./useNarrationPlayer";

export function EvalRow({ dto, computing }: { dto: LegendCompareDTO; computing: boolean }) {
  const row = evalRow(dto);
  if (row.kind === "none") return null;
  if (row.kind === "ready") {
    return (
      <div className="lc-eval" data-testid="compare-eval">
        {row.text}
      </div>
    );
  }
  return (
    <div className="lc-eval" data-pending="" aria-busy="true" role="status" data-testid="compare-eval-pending" data-computing={computing ? "" : undefined}>
      <span className="lc-ghost" aria-hidden="true" />
      {row.text}
    </div>
  );
}

export function ExplanationView({
  dto,
  explanation,
  explanationLoading,
  player,
  computing,
}: {
  dto: LegendCompareDTO;
  explanation: StaticExplanation | null;
  explanationLoading: boolean;
  player: Player;
  computing: boolean;
}) {
  const name = dto.legend.name;
  return (
    <div className="flex flex-col gap-3.5" data-testid="compare-explanation" data-state={dto.hasExplanation ? "default" : "no_explanation"}>
      {dto.hasExplanation && explanation && dto.audioUrl ? <NarrationPlayer player={player} /> : null}
      <p className="lc-p" data-testid="compare-paragraph">
        {dto.paragraph}
      </p>
      <EvalRow dto={dto} computing={computing} />
      {!dto.hasExplanation ? (
        <p className="lc-p lc-soft" data-testid="compare-no-explanation">
          This position has no narrated walkthrough yet. Your moves and {name}
          {APOS}s are in the other tabs.
        </p>
      ) : explanationLoading || !explanation ? (
        <div className="flex flex-col gap-2" aria-busy="true" data-testid="compare-explanation-loading">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-3.5 w-[90%]" />
          <Skeleton className="h-3.5 w-[70%]" />
        </div>
      ) : (
        <SegmentList explanation={explanation} current={player.segment} playing={player.playing} time={player.time} onPick={player.seekSegment} />
      )}
    </div>
  );
}
