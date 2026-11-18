"use client";

// WeaknessRow (phase-06 plan §4.6 anatomy; boards `.wrow` / `.whead` / `.wbody`):
// - header `button[aria-expanded][aria-controls]`, grid rank | label + trend | RateBar | chevron (desktop
//   24px 1fr 150px 24px, ≤ 1100 px 100 px bars, phones and iPad 20px 1fr 92px 20px), min-height 60;
// - body (open): the example MiniBoard (132 px; 96 px at vh700, on iPad and phones), the where line, "Drill · n in
//   bank" and the legend lesson link (P8; only with a lesson). No example → text and actions only.
// Drill mode (desktop and iPad L, `/train/weakness/{slug}`, DR/V3WeaknessDrill): the selected row's header carries the
// Tag "Selected" and its body is the DrillConfig; every other row's header carries a secondary "Drill" button instead
// of the chevron (no accordion while a drill is being configured).
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { WeaknessRow as Row } from "@repo/contracts/http/weakness";
import { MiniBoard } from "@/components/board/MiniBoard";
import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { copy } from "./copy";
import { LessonLink } from "./LessonLink";
import { drillPath } from "./model";
import { RateBar } from "./RateBar";

const HEAD =
  "grid w-full min-h-[60px] grid-cols-[24px_minmax(0,1fr)_150px_24px] items-center gap-3 border-0 bg-transparent px-3.5 py-2.5 text-left text-cb-text narrow:grid-cols-[24px_minmax(0,1fr)_100px_24px] rail:grid-cols-[20px_minmax(0,1fr)_92px_20px] rail:gap-2.5 rail:px-3 tabbar:grid-cols-[20px_minmax(0,1fr)_92px_20px] tabbar:gap-2.5 tabbar:px-3 [@media(max-width:360px)]:grid-cols-[20px_minmax(0,1fr)_20px] [@media(max-width:360px)]:gap-y-1.5";
/** Phones under 360 CSS px (a small phone, or any phone at 150 %): the rates move under the label. */
const NARROW_RATE = "[@media(max-width:360px)]:col-start-2 [@media(max-width:360px)]:row-start-2";
const HEAD_DRILL =
  "grid w-full min-h-[60px] grid-cols-[24px_minmax(0,1fr)_150px_auto] items-center gap-3 px-3.5 py-2.5 text-cb-text narrow:grid-cols-[24px_minmax(0,1fr)_100px_auto] rail:grid-cols-[20px_minmax(0,1fr)_92px_auto] rail:gap-2.5 rail:px-3";

export type RowMode = "accordion" | "drill-selected" | "drill-other";

function Title({ row }: { row: Row }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium [overflow-wrap:break-word]">{row.label}</span>
      <span className="text-ui text-cb-text-soft">{row.trendLabel}</span>
    </span>
  );
}

export function WeaknessRowView({
  row,
  rank,
  open,
  mode,
  scaleMax,
  withBand,
  onToggle,
  onDrill,
  bodyId,
  config,
}: {
  row: Row;
  rank: number;
  open: boolean;
  mode: RowMode;
  scaleMax: number;
  withBand: boolean;
  onToggle: () => void;
  /** "Drill · n in bank" / "Drill": opens the config (inline) or the sheet; the link's href is the drill URL. */
  onDrill: (row: Row) => void;
  bodyId: string;
  /** The DrillConfig of the selected row (drill mode). */
  config?: React.ReactNode;
}) {
  const rankCell = (
    <span aria-hidden="true" className="font-mono text-cb-text/50">
      {rank}
    </span>
  );
  const drillLink = (label: string, variant: "primary" | "secondary") => (
    <Link
      href={drillPath(row.slug)}
      prefetch={false}
      scroll={false}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        onDrill(row);
      }}
      // max-w-full + wrapping (FIX-1): at 262 px (iPhone at 150 %) "Drill · 12 in bank" ran past the card and the viewport.
      className={cn(buttonVariants({ variant }), "min-h-11 max-w-full whitespace-normal text-center")}
      data-testid={variant === "primary" ? "weakness-drill" : "weakness-drill-other"}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex flex-col border border-cb-border bg-cb-surface" data-testid="weakness-row" data-pattern={row.pattern} data-open={open ? "" : undefined} data-mode={mode}>
      {mode === "accordion" ? (
        <h3 className="m-0 text-body font-normal">
          <button type="button" className={cn(HEAD, "cursor-pointer hover:bg-cb-fill")} aria-expanded={open} aria-controls={bodyId} onClick={onToggle} data-wk-head="" data-testid="weakness-row-head">
            {rankCell}
            <Title row={row} />
            <RateBar row={row} scaleMax={scaleMax} withBand={withBand} className={NARROW_RATE} />
            <ChevronDown aria-hidden="true" className={cn("size-4 justify-self-center [@media(max-width:360px)]:col-start-3 [@media(max-width:360px)]:row-start-1 transition-transform duration-150 motion-reduce:transition-none", open ? "rotate-0" : "-rotate-90")} />
          </button>
        </h3>
      ) : (
        <div className={HEAD_DRILL} data-testid="weakness-row-head">
          <h3 className="sr-only">{row.label}</h3>
          {rankCell}
          <Title row={row} />
          <RateBar row={row} scaleMax={scaleMax} withBand={withBand} />
          {mode === "drill-selected" ? <Tag>{copy.selected}</Tag> : drillLink(copy.drill, "secondary")}
        </div>
      )}
      {mode === "accordion" && open ? (
        <div
          id={bodyId}
          className="grid animate-rc-fade grid-cols-[132px_minmax(0,1fr)] gap-4 pr-3.5 pb-3.5 pl-[50px] motion-reduce:animate-none vh700:grid-cols-[96px_minmax(0,1fr)] rail:grid-cols-[96px_minmax(0,1fr)] rail:gap-3 rail:px-3 rail:pb-3 tabbar:grid-cols-[96px_minmax(0,1fr)] tabbar:gap-3 tabbar:px-3 tabbar:pb-3"
          data-testid="weakness-row-body"
          data-example={row.example ? "" : undefined}
        >
          {row.example ? (
            <MiniBoard
              fen={row.example.fen}
              orientation={row.example.orient}
              size={132}
              label={copy.exampleLabel(row.label)}
              className="size-[132px] vh700:size-24 rail:size-24 tabbar:size-24"
              testId="weakness-example"
            />
          ) : null}
          <div className={cn("flex min-w-0 flex-col gap-2", !row.example && "col-span-2")}>
            <span className="text-ui text-cb-text-secondary">{row.where}</span>
            <div className="flex flex-wrap gap-2">
              {drillLink(copy.drillInBank(row.inBank), "primary")}
              <LessonLink lesson={row.lesson} />
            </div>
          </div>
        </div>
      ) : null}
      {mode === "drill-selected" ? config : null}
    </div>
  );
}
