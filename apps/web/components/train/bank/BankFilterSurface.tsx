"use client";

// The Filter surface, loaded on first open (BankFilter.tsx). Desktop and iPad landscape: a popover under the button
// (`role="dialog"`, "Filter positions", focus trapped, Esc closes); tab-bar mode: a bottom sheet. Content: the active
// filters as removable chips ("Remove filter Fork"), one single-choice chip group each for Theme, Phase and Source
// (a second tap clears it), Clear All and "Show n Positions".
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip, RemovableChip } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { TABBAR_MQ } from "@/lib/layout/media-queries";
import { FilterButton, type BankFilterProps } from "./BankFilter";
import { activeFilterCount, chipsOf, clearedFilters, filterGroupsOf, showLabel, toggled, withoutGroup } from "./model";

export function BankFilterSurface(props: BankFilterProps) {
  const { filter, open, onOpenChange, className } = props;
  const asSheet = useMediaQuery(TABBAR_MQ);
  // Frozen while open: rotating a phone never swaps the surface under the member (ResponsiveDialog's rule).
  const [sheetWhileOpen, setSheetWhileOpen] = useState(asSheet);
  if (!open && sheetWhileOpen !== asSheet) setSheetWhileOpen(asSheet);
  // The media query's server snapshot is false: a surface open from the first render picks its real form once.
  const settled = useRef(false);
  useEffect(() => {
    if (settled.current) return;
    settled.current = true;
    if (typeof window.matchMedia === "function") setSheetWhileOpen(window.matchMedia(TABBAR_MQ).matches);
  }, []);

  const trigger = <FilterButton count={activeFilterCount(filter)} aria-haspopup="dialog" className={className} />;

  if (sheetWhileOpen) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Filter Positions" trigger={trigger} data-testid="bank-filter-panel" closeLabel="Close filters">
        <div className="flex flex-col gap-3.5 pb-1">
          <FilterFields {...props} />
        </div>
      </ResponsiveDialog>
    );
  }
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* Never taller than the room under the trigger (desktop at 125–150 % zoom): the fields scroll and the footer
          stays in view (regression: bank-filter-popover-overflow, WP-I D-I4, e2e/devices/layout/train.spec.ts). */}
      <PopoverContent
        width={320}
        title="Filter positions"
        className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain"
        data-testid="bank-filter-panel"
      >
        <FilterFields {...props} />
      </PopoverContent>
    </Popover>
  );
}

function FilterFields({ filter, facets, onChange, results, onShow }: BankFilterProps) {
  const chips = chipsOf(filter, facets);
  const groups = filterGroupsOf(facets);
  return (
    <>
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5" data-testid="bank-filter-chips">
          <p className="m-0 w-full text-overline">Active</p>
          {chips.map((c) => (
            <RemovableChip key={c.group} onRemove={() => onChange(withoutGroup(filter, c.group))} removeLabel={`Remove filter ${c.label}`}>
              {c.label}
            </RemovableChip>
          ))}
        </div>
      ) : null}
      {groups.map((g) => (
        <fieldset key={g.group} className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid={`bank-filter-${g.group}`}>
          <legend className="mb-1.5 text-overline">{g.title}</legend>
          <div className="flex flex-wrap gap-1.5">
            {g.options.map((o) => (
              <Chip
                key={o.key}
                size="sm"
                pressed={filter[g.group] === o.key}
                onPressedChange={() => onChange(toggled(filter, g.group, o.key))}
                data-testid={`bank-filter-${g.group}-${o.key}`}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="sticky -bottom-4 -mb-4 flex items-center justify-between gap-2.5 border-t border-cb-border bg-cb-surface pt-3 pb-4">
        <Button variant="text" size="sm" onClick={() => onChange(clearedFilters(filter))} data-testid="bank-filter-clear">
          Clear All
        </Button>
        <Button size="sm" onClick={onShow} data-testid="bank-filter-show">
          {showLabel(results)}
        </Button>
      </div>
    </>
  );
}
