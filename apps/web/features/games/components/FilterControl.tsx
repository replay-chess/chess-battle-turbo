"use client";

// The archive Filter (plan §4.9 `filters_open`; DR/V3GamesArchiveFilters.dc.html): the button, and from the first open
// its surface (FilterSurface.tsx: a popover on desktop and iPad landscape, a bottom sheet in tab-bar mode). The surface
// and its popover, dialog, checkbox and segmented primitives load on that first open (a lazy chunk, warmed on hover or
// focus), so they are not in /games' First Load JS (phase-03 plan §9.6, ≤ 230 kB; FIX-2).
import { lazy, Suspense, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui/count-badge";
import { activeFilterCount, type GamesFilter } from "../model/filter";

/** "Show 7 Games" / "Show 1 Game"; "Show Games" while the count is unknown. */
export function showLabel(count: number | null): string {
  if (count == null) return "Show Games";
  return `Show ${count} ${count === 1 ? "Game" : "Games"}`;
}

export type FilterControlProps = {
  /** The applied filter (the button's count). */
  applied: GamesFilter;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: GamesFilter;
  onDraftChange: (draft: GamesFilter) => void;
  onApply: (draft: GamesFilter) => void;
  /** The live count of the draft; null while unknown. */
  draftCount: number | null;
  draftCounting: boolean;
};

/** The Filter button (the same element before and after the surface has loaded). */
export function FilterButton({ count, ...rest }: { count: number } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="secondary" iconStart={<SlidersHorizontal />} data-testid="games-filter" {...rest}>
      <span aria-hidden="true">Filter</span>
      <span className="sr-only">{count > 0 ? `Filter, ${count} active` : "Filter"}</span>
      <CountBadge count={count} />
    </Button>
  );
}

const loadSurface = () => import("./FilterSurface");
const FilterSurface = lazy(() => loadSurface().then((m) => ({ default: m.FilterSurface })));

export function FilterControl(props: FilterControlProps) {
  const { applied, open, onOpenChange } = props;
  // Mounted from the first open on, so later opens and every close keep the surface's own transitions.
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const count = activeFilterCount(applied);
  const button = (
    <FilterButton
      count={count}
      onClick={() => onOpenChange(true)}
      // Warm the chunk as soon as the pointer or the focus reaches the button.
      onPointerEnter={() => void loadSurface()}
      onFocus={() => void loadSurface()}
    />
  );
  if (!mounted) return button;
  return (
    <Suspense fallback={button}>
      <FilterSurface {...props} />
    </Suspense>
  );
}
