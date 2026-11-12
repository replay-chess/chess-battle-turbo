"use client";

// The archive Filter's surface, loaded on the first open (FilterControl.tsx, FIX-2). The archive Filter (plan §4.9 `filters_open`; DR/V3GamesArchiveFilters.dc.html): a popover on desktop and iPad
// landscape, a bottom sheet in tab-bar mode (phones, iPad portrait). Both edit a DRAFT: the active filters as
// removable chips, a Result segmented control (All, Wins, Losses, Draws), Time Control chips, "Only games with moments
// to review", Clear All and the primary "Show N Games" with a live count (G1 `limit=0`, the screen debounces it).
// Show applies the draft; Esc, an outside click or the sheet's dismiss discard it.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxRow } from "@/components/ui/checkbox";
import { Chip, ChipGroup, RemovableChip } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Segmented } from "@/components/ui/segmented";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { TABBAR_MQ } from "@/lib/layout/media-queries";
import { FilterButton, showLabel, type FilterControlProps } from "./FilterControl";
import {
  TC_FILTERS,
  activeFilterCount,
  clearedFilters,
  filterChips,
  resultSegmentOf,
  tcFilterLabel,
  withMoments,
  withResultSegment,
  withTc,
  type GameTcFilter,
  type ResultSegment,
} from "../model/filter";

const RESULT_ITEMS: { value: ResultSegment; label: string }[] = [
  { value: "all", label: "All" },
  { value: "win", label: "Wins" },
  { value: "loss", label: "Losses" },
  { value: "draw", label: "Draws" },
];

export function FilterSurface(props: FilterControlProps) {
  const { applied, open, onOpenChange } = props;
  const asSheet = useMediaQuery(TABBAR_MQ);
  // Frozen while open, so rotating a phone never swaps the surface under the user (ResponsiveDialog's rule).
  const [sheetWhileOpen, setSheetWhileOpen] = useState(asSheet);
  if (!open && sheetWhileOpen !== asSheet) setSheetWhileOpen(asSheet);
  // The server snapshot of the media query is false: a filter that is open from the first render (the
  // `filters_open` demo) picks its real surface once, after hydration.
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current) return;
    settled.current = true;
    if (typeof window.matchMedia === "function") setSheetWhileOpen(window.matchMedia(TABBAR_MQ).matches);
  }, []);
  const count = activeFilterCount(applied);

  const trigger = <FilterButton count={count} />;

  if (sheetWhileOpen) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Filters" trigger={trigger} data-testid="games-filter-panel">
        <div className="flex flex-col gap-3.5 pb-1">
          <FilterFields {...props} />
        </div>
      </ResponsiveDialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent width={340} title="Filters" data-testid="games-filter-panel">
        <FilterFields {...props} />
      </PopoverContent>
    </Popover>
  );
}

function FilterFields({ draft, onDraftChange, onApply, draftCount, draftCounting }: FilterControlProps) {
  const chips = filterChips(draft);
  return (
    <>
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5" data-testid="games-filter-chips">
          {chips.map((c) => (
            <RemovableChip key={c.id} onRemove={() => onDraftChange(c.without)}>
              {c.label}
            </RemovableChip>
          ))}
        </div>
      ) : null}
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 text-overline">Result</legend>
        <Segmented<ResultSegment>
          aria-label="Result"
          fill
          value={resultSegmentOf(draft)}
          onValueChange={(v) => onDraftChange(withResultSegment(draft, v))}
          items={RESULT_ITEMS}
          data-testid="games-filter-result"
        />
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend id="games-filter-tc" className="mb-1.5 text-overline">
          Time control
        </legend>
        <ChipGroup<GameTcFilter>
          type="multiple"
          aria-labelledby="games-filter-tc"
          value={draft.tc ?? []}
          onValueChange={(v) => onDraftChange(withTc(draft, v))}
          data-testid="games-filter-tc"
          className="gap-1.5"
        >
          {TC_FILTERS.map((tc) => (
            <Chip key={tc} value={tc}>
              {tcFilterLabel(tc)}
            </Chip>
          ))}
        </ChipGroup>
      </fieldset>
      <CheckboxRow
        label="Only games with moments to review"
        checked={Boolean(draft.moments)}
        onCheckedChange={(v) => onDraftChange(withMoments(draft, v))}
        data-testid="games-filter-moments"
      />
      <div className="flex items-center justify-between border-t border-cb-border pt-3">
        <Button variant="text" size="sm" onClick={() => onDraftChange(clearedFilters(draft))} data-testid="games-filter-clear">
          Clear All
        </Button>
        <Button
          size="sm"
          onClick={() => onApply(draft)}
          aria-busy={draftCounting || undefined}
          data-testid="games-filter-show"
        >
          {showLabel(draftCount)}
        </Button>
      </div>
    </>
  );
}
