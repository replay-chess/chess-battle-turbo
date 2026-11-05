"use client";

// ProgressBar and StackedBar (SPEC 6.2; 02 §5.17 `.bar`, V4Profile `.hbar`).
import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export type ProgressBarProps = {
  value: number;
  /** Default 100. */
  max?: number;
  /** Required accessible name ("Import progress"). */
  label: string;
  /** Announced value; default "<value> of <max>[ <unit>]". */
  valueText?: string;
  /** Appended to the default value text: "212 of 480 games". */
  unit?: string;
  /** thin = 2px, md = 4px. Default md. */
  size?: "thin" | "md";
  className?: string;
  "data-testid"?: string;
};

export function progressValueText(value: number, max: number, unit?: string): string {
  return `${value} of ${max}${unit ? ` ${unit}` : ""}`;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  unit,
  size = "md",
  className,
  "data-testid": testId,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const pct = (clamped / safeMax) * 100;
  return (
    <ProgressPrimitive.Root
      value={clamped}
      max={safeMax}
      aria-label={label}
      getValueLabel={(v, m) => valueText ?? progressValueText(v, m, unit)}
      data-testid={testId}
      className={cn("relative w-full overflow-hidden bg-cb-border", size === "thin" ? "h-0.5" : "h-1", className)}
    >
      <ProgressPrimitive.Indicator
        style={{ width: `${pct}%` }}
        className="absolute inset-y-0 left-0 bg-cb-accent transition-[width] duration-200 ease-linear motion-reduce:transition-none"
      />
    </ProgressPrimitive.Root>
  );
}

export type StackedBarSegment = {
  value: number;
  tone: "good" | "neutral" | "bad";
  /** Read in the summary: "Wins 12". */
  label: string;
};

const SEGMENT_TONE: Record<StackedBarSegment["tone"], string> = {
  good: "bg-cb-good",
  neutral: "bg-cb-text-muted",
  bad: "bg-cb-bad",
};

/** A segmented 8px bar (wins / draws / losses). role="img" with a text summary. */
export function StackedBar({
  segments,
  label,
  className,
  "data-testid": testId,
}: {
  segments: StackedBarSegment[];
  /** Prefix of the summary: "Results". */
  label: string;
  className?: string;
  "data-testid"?: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const summary = `${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`;
  return (
    <div role="img" aria-label={summary} data-testid={testId} className={cn("flex h-2 w-full overflow-hidden bg-cb-border-subtle", className)}>
      {total > 0
        ? segments.map((s, i) =>
            s.value > 0 ? (
              <span key={i} className={cn("block h-full", SEGMENT_TONE[s.tone])} style={{ width: `${(s.value / total) * 100}%` }} />
            ) : null,
          )
        : null}
    </div>
  );
}
