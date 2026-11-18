"use client";

// DrillConfig (phase-06 plan §4.7; DR/V3WeaknessDrill `drill`): size 10 / 20, "Fill with matched Lichess puzzles", the
// mix line and the CTA, all from `previewWeaknessDrill` (TRN, the same arithmetic the server composer uses):
//   default   "6 from your games + 4 matched Lichess puzzles near 1512", "Start drill · 10 positions · ~5 min"
//   size20    12 + 8, "~10 min"
//   mixOff    "12 from your games only (12 in your bank)"; fewer own positions than the size → the real count (`few`)
//   unmatched the checkbox is disabled and described ("No matching puzzles …" / the time-pressure sentence)
//   zeroOwn   checked and disabled: matched puzzles only
//   empty     nothing to drill: the CTA is disabled with the "No positions to drill yet" line (also after a 400
//             `validation_failed {reason: "empty_drill"}` from TR-7)
//   starting  the CTA spins (aria-busy), the controls are disabled
//   rateLimited the inline countdown under the CTA (429 `train-session`)
// Inline (desktop, iPad L): two columns, label + controls | CTA + the legend-lesson row. Sheet (phones, iPad P): one
// column, the CTA pinned to the sheet's bottom.
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import type { WeaknessRow } from "@repo/contracts/http/weakness";
import { weaknessNoun } from "@repo/chess-training/themes";
import { drillTitle, previewWeaknessDrill } from "@repo/chess-training/weakness/drill";
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { Button } from "@/components/ui/button";
import { CheckboxRow } from "@/components/ui/checkbox";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { lessonHref } from "./LessonLink";
import { RateLimitedInline } from "./RateLimitedInline";

export type DrillSize = 10 | 20;

export type DrillControls = {
  size: DrillSize;
  mix: boolean;
  onSize: (s: DrillSize) => void;
  onMix: (m: boolean) => void;
  onStart: () => void;
  onIntent?: () => void;
  starting: boolean;
  /** The server answered `empty_drill` for this pattern. */
  emptyFromServer: boolean;
  limit?: RetryCountdownState;
};

export function drillPreview(row: Pick<WeaknessRow, "pattern" | "inBank">, rating: number | null, size: DrillSize, mix: boolean) {
  return previewWeaknessDrill({ pattern: row.pattern, inBank: row.inBank, size, mix, rating });
}

export function mixDescription(reason: ReturnType<typeof previewWeaknessDrill>["mixDisabledReason"], pattern: string): string | undefined {
  if (reason === "time_pressure") return copy.timePressure;
  if (reason === "unmatched") return copy.unmatched;
  // FIX-2 (round-2 #26): the weakness noun ("free-piece"), never the P5 puzzle label ("loose piece").
  if (reason === "zero_own") return copy.zeroOwn(weaknessNoun(pattern));
  return undefined;
}

export function DrillConfig({
  row,
  rating,
  controls,
  layout,
  id,
}: {
  row: WeaknessRow;
  rating: number | null;
  controls: DrillControls;
  layout: "inline" | "sheet";
  id?: string;
}) {
  const { size, mix, starting } = controls;
  const preview = drillPreview(row, rating, size, mix);
  const empty = preview.empty || controls.emptyFromServer;
  const sheet = layout === "sheet";
  const title = drillTitle(row.pattern);
  const cta = (
    <div className={cn("flex flex-col gap-1.5", sheet && "sticky bottom-0 -mx-4 border-t border-cb-border bg-cb-surface px-4 pt-2.5 pb-1")}>
      <Button
        size="lg"
        block
        loading={starting}
        disabled={empty}
        onClick={() => {
          if (!controls.limit?.limited && !empty) controls.onStart();
        }}
        onPointerEnter={controls.onIntent}
        onFocus={controls.onIntent}
        data-testid="weakness-drill-start"
        {...(controls.limit?.controlProps ?? {})}
      >
        {preview.cta}
      </Button>
      {controls.limit ? <RateLimitedInline countdown={controls.limit} lead={copy.tooManySessions} /> : null}
    </div>
  );
  return (
    <div
      id={id}
      className={cn(
        sheet
          ? "flex flex-col gap-3"
          : // Two columns only when the row is wide enough for the CTA (FIX-1: at 125 % zoom, 1152 px, the viewport rule kept
            // two columns in a 470 px row and clipped "Start drill · 10 positions · ~5 min"): a container query on the row.
            "grid animate-rc-fade grid-cols-1 gap-3 border-t border-cb-border bg-cb-bg py-3.5 pr-4 pb-4 pl-4 @min-[34rem]:grid-cols-2 @min-[34rem]:gap-6 @min-[34rem]:pl-[58px] motion-reduce:animate-none",
      )}
      data-testid="weakness-drill-config"
      // Inline (desktop, iPad L) the config replaces the Drill link the member activated: it takes the focus (FIX-1,
      // WCAG 2.4.3), as a named group, so the keyboard lands in it instead of on <body>.
      {...(sheet ? {} : { role: "group", "aria-label": title, tabIndex: -1 })}
      data-size={size}
      data-mix={preview.mixEff ? "on" : "off"}
      data-empty={empty ? "" : undefined}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {sheet ? null : <span className="text-overline">{title}</span>}
        <Segmented<"10" | "20">
          aria-label={copy.drillSize}
          value={String(size) as "10" | "20"}
          onValueChange={(v) => controls.onSize(v === "20" ? 20 : 10)}
          items={[
            { value: "10", label: copy.size10 },
            { value: "20", label: copy.size20 },
          ]}
          disabled={starting}
          size="touch"
          className="self-start"
          data-testid="weakness-drill-size"
        />
        <CheckboxRow
          label={copy.mixLabel}
          description={mixDescription(preview.mixDisabledReason, row.pattern)}
          checked={preview.mixEff}
          onCheckedChange={controls.onMix}
          disabled={preview.mixDisabled || starting}
          data-testid="weakness-drill-mix"
        />
        <p className="m-0 text-sm text-cb-text-secondary" data-testid="weakness-drill-mixline">
          {empty ? copy.empty : preview.mixLine}
        </p>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-0">
        {sheet ? null : cta}
        {row.lesson ? (
          <Link href={lessonHref(row.lesson)} prefetch={false} className="flex min-h-[52px] items-center gap-3 border-b border-cb-border py-1.5 text-cb-text no-underline hover:bg-cb-fill" data-testid="weakness-drill-lesson">
            <BookOpen aria-hidden="true" className="size-[18px] shrink-0" />
            <span className="flex min-w-0 flex-auto flex-col">
              <span>{copy.lessonLink(row.lesson.title)}</span>
              <span className="text-ui text-cb-text-soft">{row.lesson.sub}</span>
            </span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        ) : null}
      </div>
      {sheet ? cta : null}
    </div>
  );
}
